import { generateCompletion, type LLMConfig } from './llm';
import { chunkText } from './rag';
import DOMPurify from 'dompurify';

function safeSanitize(input: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    // No DOM available (e.g. Worker context) — return input as-is.
    // XSS risk is acceptable here since output is rendered by the
    // controlled UI layer, not injected into external HTML.
    return input;
  }
  return DOMPurify.sanitize(input);
}

export type ProcessCallback = (progress: number, status: string) => void;

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

const executeWorker = (type: string, payload: any): Promise<any> => {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).substring(7);
    const handler = (e: MessageEvent) => {
      if (e.data.id === id) {
        worker.removeEventListener('message', handler);
        if (e.data.type === 'SUCCESS') resolve(e.data.payload);
        else reject(new Error(e.data.payload));
      }
    };
    worker.addEventListener('message', handler);
    worker.postMessage({ type, payload, id });
  });
};

export interface PreProcessOptions {
  files: File[];
  outputType: string;
  llmConfig: LLMConfig;
  onProgress: ProcessCallback;
  signal?: AbortSignal;
}

export async function runPreProcessing({ files, outputType, llmConfig, onProgress, signal }: PreProcessOptions): Promise<string> {
  onProgress(10, 'Stage 1: AI Pre-Processing files...');
  let compiledContext = '';

  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) {
      const err = new Error('AbortError');
      err.name = 'AbortError';
      throw err;
    }
    const file = files[i];
    onProgress(10 + Math.floor((i / files.length) * 20), `Extracting & Analyzing ${file.name}...`);
    
    const rawText = await executeWorker('EXTRACT_TEXT', { file });
    const MAX_CHUNK_SIZE = 12000;

    const extractionFocus: Record<string, string> = {
      BRD: `Focus on: business goals, stakeholder needs, success metrics,
          cost/benefit data, organizational constraints, project scope
          boundaries, and approval workflows.
          Extract business rules as: "The business requires [X] because [Y]."
          Do NOT extract system implementation details or UI descriptions.`,
      FRD: `Focus on: system functions, user roles and permissions, input/output
          pairs, data validation rules, error conditions, interface
          dependencies, and performance thresholds.
          Extract each function as: "When [actor] does [action], the system
          must [response]."`,
      PRD: `Focus on: user personas, pain points, product goals, feature
          descriptions, success metrics, market context, and user journeys.
          Extract user needs as: "As a [persona], they need [capability]
          because [reason]."`,
      CRD: `Focus on: the original approved state, what has changed and why,
          who requested the change, impact on scope/budget/timeline,
          affected requirement IDs, and rollback considerations.
          Extract each change as: "Original: [X]. Proposed: [Y]. Reason: [Z]."`,
    };

    const focusInstruction = extractionFocus[outputType] || extractionFocus.BRD;

    if (rawText.length <= MAX_CHUNK_SIZE) {
      const prompt = `Analyze this source file and extract highly detailed,
      structured notes for use in generating a ${outputType} document.

      EXTRACTION FOCUS FOR ${outputType}:
      ${focusInstruction}

      GENERAL RULES:
      - Do NOT generate Mermaid diagrams at this stage.
      - Do NOT write a requirements document — only extract raw notes.
      - Preserve all numbers, dates, names, and metrics exactly as found.
      - If a piece of information is ambiguous, note it as:
        [AMBIGUOUS: {what is unclear}]

      SOURCE DATA:
      ${rawText}`;

      const aiNotes = await generateCompletion(llmConfig, [
        { role: 'system', content: `You are an expert ${outputType} Document Analyst.` },
        { role: 'user', content: prompt }
      ], 0.3, signal);
      
      compiledContext += `## Deep Analysis: ${file.name}\n\n${aiNotes}\n\n`;
    } else {
      const chunks = chunkText(rawText, file.name, MAX_CHUNK_SIZE, 500);
      let fileNotes = '';
      
      for (let j = 0; j < chunks.length; j++) {
        if (signal?.aborted) {
          const err = new Error('AbortError');
          err.name = 'AbortError';
          throw err;
        }
        
        const baseProgress = 10 + Math.floor((i / files.length) * 20);
        const subProgress = Math.floor(((j + 1) / chunks.length) * (20 / files.length));
        onProgress(baseProgress + subProgress, `Extracting & Analyzing ${file.name} (Part ${j + 1} of ${chunks.length})...`);
        
        const chunkContinuityNote = j > 0
          ? `NOTE: This is a continuation of a larger document. Avoid duplicating
       notes already captured in earlier parts. Focus on NEW information
       introduced in this portion only. If a requirement from a previous
       part is completed or contradicted here, note it explicitly.`
          : `NOTE: This is the opening portion of the document. Capture all
       foundational context including project purpose, scope, and key actors.`;

        const prompt = `Analyze Part ${j + 1} of ${chunks.length} of the
        source document. Extract structured notes for a ${outputType} document.

        ${chunkContinuityNote}

        EXTRACTION FOCUS FOR ${outputType}:
        ${focusInstruction}

        RULES:
        - Do NOT generate Mermaid diagrams at this stage.
        - Do NOT write a requirements document — only extract raw notes.
        - Preserve all numbers, dates, names, and metrics exactly.

        SOURCE DATA:
        ${chunks[j].content}`;
        
        const aiNotes = await generateCompletion(llmConfig, [
          { role: 'system', content: `You are an expert ${outputType} Document Analyst.` },
          { role: 'user', content: prompt }
        ], 0.3, signal);
        
        fileNotes += `### Part ${j + 1}\n\n${aiNotes}\n\n`;
      }
      compiledContext += `## Deep Analysis: ${file.name}\n\n${fileNotes}\n\n`;
    }
  }
  
  return compiledContext;
}

export interface FinalProcessOptions {
  projectName: string;
  creatorName: string;
  compiledContext: string;
  outputType: string;
  baseTemplate?: string;
  templateFile?: File | null;
  processingMode: 'bulk' | 'semantic';
  llmConfig: LLMConfig;
  applyPolish?: boolean;
  onProgress: ProcessCallback;
  signal?: AbortSignal;
}

export interface GeneratedSection {
  header: string;
  content: string;
}

export interface GeneratedData {
  projectName: string;
  creatorName: string;
  outputType: string;
  sections: GeneratedSection[];
}

export type GenerationResult =
  | { success: true; data: GeneratedData }
  | { success: false; reason: 'aborted' | 'context-too-large' | 'api-error' | 'template-error'; message: string; partialSections?: GeneratedSection[] };

export async function runFinalGeneration({ projectName, creatorName, compiledContext, outputType, baseTemplate, templateFile, processingMode, llmConfig, applyPolish, onProgress, signal }: FinalProcessOptions): Promise<GenerationResult> {
  const sections: GeneratedSection[] = [];
  try {
    if (signal?.aborted) {
      const err = new Error('AbortError');
      err.name = 'AbortError';
      throw err;
    }

    if (!compiledContext || compiledContext.trim() === '') {
      throw new Error("No readable context found for processing.");
    }

    if (processingMode === 'semantic') {
      onProgress(35, 'Stage 1.5: Indexing Deep Context for Semantic Processing...');
      await executeWorker('INDEX_DB', { compiledContext });
    }
    const compiledMarkdown = compiledContext;
    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const ENTERPRISE_SYSTEM_PROMPT = `You are an expert Business Analyst.
Produce a finalized, canonical requirements document.

UNIVERSAL RULES:
1. Tone: Professional, executive, concise. NO conversational AI filler,
   meta-commentary, or introductory phrases.
2. Formatting: Prefer bullets and tables. Consolidate duplicates.
   Normalize terminology.
   For any workflow, process flow, decision tree, or state machine
   described in the source data, generate a \`\`\`mermaid code block
   immediately after the relevant section content to visualize it.
   Use flowchart TD for process flows, sequenceDiagram for system
   interactions, and stateDiagram-v2 for state machines.
3. Hallucination Guard: NEVER output internal prompt instructions like
   "DOCUMENT METADATA" or "SECTION DEFINITION". Never output raw code
   syntax like \${projectName}, \${version}, or \${status}. Do not
   hallucinate dates; use the exact Date provided in the user prompt.
4. Missing Data: NEVER invent data or use generic placeholders. If
   information is missing or inferred, output EXACTLY:
   [CLARIFICATION NEEDED: {Explanation}]. Do not use any other tag.
5. Depth Requirement: Every section must be substantive. For analytical
   sections (Impact Analysis, Cost-Benefit, Risk), write a minimum of
   5 bullet points or 3 table rows even if source data is sparse —
   fill gaps with [CLARIFICATION NEEDED: ...] tags.

DOCUMENT-TYPE-SPECIFIC LANGUAGE RULES:
- BRD: Use "the project shall" for mandatory outcomes. Requirements are
  business-outcome focused — they describe WHAT the business needs,
  not HOW the system works.
- FRD: Use "the system shall" for binding functional requirements and
  "the system should" for non-binding ones. Requirements must be atomic,
  testable, and include a condition ("when [X], the system shall [Y]").
- PRD: Write from the product perspective. Use "As a [role], I want
  [action] so that [benefit]" for user stories. Features use P0/P1/P2
  priority tiers. Avoid "shall" language in PRD sections.
- CRD: Every statement must be change-delta focused — describe the
  difference between current state and proposed state. Be precise,
  factual, and impact-focused. Justify every change with source evidence.`;

    // ---------------------------------------------------------
    // Stage 2: Template Parsing
    // ---------------------------------------------------------
    let templateText = '';
    onProgress(40, 'Stage 2: Selecting and parsing template...');

    if (baseTemplate === 'custom' && templateFile) {
      templateText = await executeWorker('EXTRACT_TEXT', { file: templateFile });
    } else if (baseTemplate === 'enterprise' && outputType === 'BRD') {
      templateText = `Document Title: BRD — \${projectName}
Project Name: \${projectName}
Author / Created By: \${creatorName}
Date: \${currentDate}
Version: \${version}
Status: \${status}

0. PROJECT BACKGROUND
- Why was this project initiated?
- What is the current situation or problem (include supporting data or statistics)?
- What strategic opportunity or organizational pain point is being addressed?
---
1. EXECUTIVE SUMMARY
Using data from the source, write a sharp 3–5 sentence summary covering:
- The problem or opportunity identified (include any statistics or survey data if available)
- The proposed solution and its mechanism
- Resources required (budget, key people, tools)
- Expected outcome in one line
---
2. PROJECT OBJECTIVES (S.M.A.R.T.)
Extract or derive 3–5 measurable goals from the source. Format each as:
- [Action verb] + [metric] + [by how much] + [by when]
- Objective 1:
- Objective 2:
- Objective 3:
Flag any objective that lacks a measurable target.
---
3. NEEDS STATEMENT
Write 2–3 sentences that:
- Connect the project directly to a named business-wide goal from the source
- Quantify the organizational impact where data is available
- State consequences of inaction
---
4. PROJECT SCOPE (IN / OUT)
In-Scope (with measurable targets where possible):
- [Deliverable + quantity or success metric]
- [Deliverable + tracking period]

Out-of-Scope:
- [Explicitly excluded items from source]
---
5. CURRENT VS. PROPOSED PROCESS
Current Process:
- Tools/methods used today, specific pain points from source

Proposed Process:
- New tools/workflow, how they directly resolve each pain point
---
6. REQUIREMENTS (PRIORITIZED)
Prioritize all requirements derived from the source.
Assign a BR-ID to each requirement so it can be traced in Section 13.
- BR-01 (HIGH): [Blocking requirement — must be done first]
- BR-02 (HIGH): [Blocking requirement]
- BR-03 (MEDIUM): [Important, non-blocking requirement]
- BR-04 (MEDIUM): [Important, non-blocking requirement]
- BR-05 (LOW): [Enhancement or optional item]
Add or remove BR-IDs based on project complexity.
---
7. BUSINESS & NON-FUNCTIONAL REQUIREMENTS
Business Requirements (what the business/project must deliver):
- BR1: The project shall [deliver business outcome]...
- BR2: The project shall [deliver business outcome]...
- BR3: The project should [deliver optional business outcome]...

Non-Functional Requirements (quality constraints on the solution):
- NFR1: [Performance / speed / security / reliability threshold]
- NFR2: [Compliance or regulatory requirement]
- NFR3: [Availability or uptime expectation]
---
8. USE CASES & BUSINESS RULES
Use Case Format:
- UC-ID | Actor | Precondition | Main Flow | Alternate Flow | Postcondition
UC-01 | | | | |

Business Rules:
- Rule 1: [Condition or logic that governs the solution]
- Rule 2:
---
9. DATA REQUIREMENTS
- Data Inputs: [What data enters the system and from where]
- Data Outputs: [What data or reports are generated]
- Data Storage: [What must be stored and where]
- Validation Rules: [What is allowed / not allowed]
- Retention Policy: [How long data is kept, when it is deleted]
---
10. KEY STAKEHOLDERS
Extracted from source:
Name | Role | Specific Contribution to This Project
Include: decision-makers, team leads, HR, end users, and approvers
---
11. ASSUMPTIONS & CONSTRAINTS
Assumptions (derived from source):
- A1: [State assumption + risk if wrong]
- A2:
- A3:

Constraints (derived from source):
- Budget: [Total available + allocation breakdown]
- Timeline: [Phase 1 deadline + total tracking window]
- Security: [Named compliance requirements]
- Regulatory / Compliance: [Named regulations]
- Other: [Resource gaps, skill dependencies, external constraints]
---
12. COST-BENEFIT ANALYSIS & FINANCIALS
Costs (from source):
- Explicit: [Named direct costs with figures if available]
- Implicit: [Time, opportunity, or resource diversion costs]

Benefits (from source):
- Explicit: [Measurable gains — productivity %, retention rate, etc.]
- Implicit: [Long-term or indirect gains — morale, brand, scalability]

Financial Summary:
- Estimated Investment:
- Expected Return / ROI:
- Payback Period:

Final Verdict: In 2 sentences, confirm the project's ROI justification based on the above.
---
13. TRACEABILITY MATRIX
Map each requirement back to a business objective:
Requirement ID | Requirement Title | Linked Business Objective | Test Case ID | Status
BR-01 | | | TC-01 | Not tested
BR-02 | | | TC-02 | Not tested
---
14. REVISION HISTORY
Version | Date | Author | Summary of Changes
v1.0 | \${currentDate} | \${creatorName} | Initial draft
---
15. SIGN-OFF
Reviewer Name | Role | Status (Approved / Pending / Rejected) | Date | Comments
[Name] | [Role] | Pending | |
[Name] | [Role] | Pending | |`;
    } else if (baseTemplate === 'enterprise' && outputType === 'FRD') {
      templateText = `Document Title: FRD — \${projectName}
Project Name: \${projectName}
Author / Created By: \${creatorName}
Date: \${currentDate}
Version: \${version}
Status: \${status}

1. INTRODUCTION & PURPOSE
Extract from source:
- The business problem this system is solving
- The intended audience for this FRD
---
2. SCOPE
In-Scope: 
Out-of-Scope: 
---
3. GLOSSARY & TERMINOLOGY
---
4. SYSTEM OVERVIEW
Derived from source:
- Describe the system being built or modified
- How does it fit into the existing workflow?
---
5. USER ROLES & PERMISSIONS
Role | Access Level
---
6. FUNCTIONAL REQUIREMENTS
Derive ALL functional requirements from the source. 
Format each as:
ID | Title | The system shall [action] when [condition] | Priority | Source Reference
---
7. NON-FUNCTIONAL REQUIREMENTS
NFR-01 | Performance | 
NFR-02 | Security | 
NFR-03 | Reliability | 
---
8. USE CASES & USER STORIES
Use Case Format:
- UC-ID | Actor | Trigger | Main Flow | Expected Outcome

User Story Format:
"As a [role], I want to [action], so that [benefit]."
---
9. PROCESS FLOWS & WORKFLOWS
For each key system process, describe the flow:
- Process Name:
- Trigger: [What initiates the process]
- Steps: Step 1 → Step 2 → Step 3 → End state
- Decision Points: [Any if/else conditions]
- Systems Involved: [Tools, databases, integrations]
(Attach diagrams or flowcharts where possible)
---
10. UI/UX REQUIREMENTS
Screen / Page | Key Components | Behavior on Interaction | Validation Rules
[Login] | [Form fields] | [Redirect on success] | [Required fields, format]
[Dashboard] | [Charts, tables] | [Filter, export] | [Data range limits]
Note any wireframes, mockups, or design specs referenced in source.
---
11. DATA REQUIREMENTS
- Data Inputs: [What data enters the system and from where]
- Data Outputs: [What data or reports are generated]
- Data Storage: [What must be stored and where]
- Data Formats: [File types, structures, e.g. JSON, CSV]
- Validation Rules: [What is allowed / not allowed]
- Retention & Deletion: [How long data is kept, when it is deleted]
---
12. INTERFACE REQUIREMENTS
- User Interfaces: [Web, mobile, desktop]
- External System Interfaces: [Third-party APIs, tools, platforms]
- Hardware Interfaces: [Devices, sensors, printers, etc.]
- Software Interfaces: [Other internal systems this integrates with]
- Communication Interfaces: [Email, SMS, webhooks, protocols]
---
13. ERROR HANDLING & EDGE CASES
ERR-ID | Scenario | System Response | Recovery Path
ERR-01 | [What went wrong] | [What the system should display or do] | [How user or system recovers]
ERR-02 | | |
---
14. ACCEPTANCE CRITERIA
For each functional requirement, define the condition for completion:
- FR-01 is complete when: [specific, testable condition]
- FR-02 is complete when: [specific, testable condition]
- FR-03 is complete when: [specific, testable condition]
---
15. ASSUMPTIONS & DEPENDENCIES
Assumptions:
- A1: [Assumed condition] — Risk if wrong: [consequence]
- A2: [Assumed condition] — Risk if wrong: [consequence]

Dependencies:
- D1: [Internal system or team this FRD depends on] — Owner: [name]
- D2: [External vendor, API, or service] — SLA: [availability expectation]
---
16. CONSTRAINTS
- Technical: [Platform, stack, or architectural limitation]
- Timeline: [Hard delivery deadline]
- Budget: [Resource or cost ceiling]
- Regulatory: [Named compliance rule or standard applicable to this system]
- Operational: [Deployment, environment, or support constraint]
---
17. TRACEABILITY MATRIX
Requirement ID | Requirement Title | Linked Business Objective | Test Case ID | Status
FR-01 | | | TC-01 | Not tested
FR-02 | | | TC-02 | Not tested
(Ensures no requirement is orphaned or untested)
---
18. REVISION HISTORY
Version | Date | Author | Summary of Changes
v1.0 | \${currentDate} | \${creatorName} | Initial draft
---
19. APPROVAL & SIGN-OFF
Reviewer Name | Role | Status (Approved / Pending / Rejected) | Date | Comments
[Name] | [Role] | Pending | |
[Name] | [Role] | Pending | |`;
    } else if (baseTemplate === 'enterprise' && outputType === 'PRD') {
      templateText = `Document Title: PRD — \${projectName}
Project Name: \${projectName}
Author / Created By: \${creatorName}
Date: \${currentDate}
Version: \${version}
Status: \${status}

1. PRODUCT OVERVIEW & PURPOSE
Derived from source:
- Summarize the product in 2–3 sentences
- Extract where this product fits in the existing system or workflow
- Write a product pitch sentence: For [user], who [pain point], the [product] is a [category] that [key benefit]
---
2. PROBLEM STATEMENT
Extracted from source:
- State the exact problem
- Quantify impact
- Identify who suffers most from this problem
- State consequence of inaction
---
3. GOALS & SUCCESS METRICS
Business Goals: 
Product Goals: 

Success Metrics Table:
Metric | Target | Measurement Method | Timeline
[e.g. DAU] | [+20%] | [Analytics dashboard] | [3 months post-launch]
[e.g. NPS] | [Score > 40] | [User survey] | [6 months post-launch]
---
4. TARGET USERS & MARKET ASSESSMENT
Extracted from source stakeholder and needs sections:
- Primary Users: 
- Secondary Users: 
- Market Context: 
- Competitive Positioning: 
---
5. USER PERSONAS
Derived from source roles, stakeholders, and use context:
Persona 1:
- Name: 
- Role: 
- Goals: 
- Pain Points: 
- How product helps: 

Persona 2:
---
6. USER STORIES & USE CASES
Derived from source objectives, scope, and process flows:
User Stories:
"As a [role], I want to [action], so that [benefit]."
US-01: 
US-02: 

Use Cases:
UC-ID | Actor | Trigger | Main Flow | Alt Flow | Expected Outcome
---
7. PRODUCT FEATURES & FUNCTIONAL REQUIREMENTS
Auto-generate from source requirements, scope, and proposed process:
PR-ID | Feature Name | Description | Priority | Persona | Source Reference

Priority Guide:
- P0 (Must Have): Launch is blocked without this — tied to HIGH source requirement
- P1 (Should Have): Core value, include if possible — tied to MEDIUM source requirement
- P2 (Nice to Have): Enhancement, not critical — tied to LOW source requirement
---
8. NON-FUNCTIONAL REQUIREMENTS
Derived from source constraints, security, and performance goals:
NFR-01 | Performance | 
NFR-02 | Security | 
NFR-03 | Reliability | 
NFR-04 | Scalability | 
NFR-05 | Accessibility | 
NFR-06 | Localization | 
NFR-07 | Compliance | 
---
9. TECHNICAL REQUIREMENTS
Derived from source tools, system overview, and interface requirements:
- Platform: 
- Integrations: 
- Data Architecture: 
- Tech Stack: 
- Infrastructure: 
- Supported Environments: 
---
10. UX / DESIGN REQUIREMENTS
Derived from source process flows, user personas, and scope:
- Key Screens: 
- Critical User Flows: 
- Component Needs: 
- Accessibility: 
- Design Guidance: 
---
11. ASSUMPTIONS & OPTIONS
Assumptions:
- A1: 
- A2: 

Options Considered:
Option | Description | Pros | Cons | Decision
[Option A] | [Description] | [Pros] | [Cons] | [Chosen / Rejected]
[Option B] | [Description] | [Pros] | [Cons] | [Chosen / Rejected]
---
12. DEPENDENCIES
Internal:
- D1: [Internal system, team, or component this product depends on]
- D2: [Additional internal dependency if applicable]

External:
- D3: [Third-party API, vendor service, or external platform]
- D4: [Additional external dependency if applicable]
---
13. CONSTRAINTS & OUT-OF-SCOPE
Constraints:
- Timeline: 
- Budget: 
- Team: 
- Technical: 

Out-of-Scope:
- [Feature excluded + reason]
---
14. RELEASE PLAN & MILESTONES
Derived from source timeline and project scope:
Phase | Milestone | Owner | Target Date | Status
Discovery | Problem validated | PM | |
Design | Wireframes approved | Designer | |
Development | Feature complete | Tech Lead | |
QA | All test cases passed | QA Lead | |
Launch | Feature shipped | PM | |
Post-launch | Metrics review | PM | [Date + 30 days] |
---
15. OPEN QUESTIONS
Auto-generate from gaps in the source:
Q-ID | Question | Owner | Answer | Date Resolved
---
16. RISKS
Derived from source risk section, constraints, and assumptions:
Risk ID | Description | Likelihood | Impact | Mitigation
R-01 | [Risk description] | High / Med / Low | High / Med / Low | [How to reduce it]
R-02 | | | |
---
17. SUPPORT & ENVIRONMENTAL REQUIREMENTS
Derived from source onboarding, training, and operational context:
- Support Model: 
- Documentation Needed: 
- Training: 
- Environments: 
- Monitoring: 
---
18. TRACEABILITY & ACCEPTANCE CRITERIA
Auto-generate from features and user stories above:
PR-ID | Feature | Linked User Story | Acceptance Criteria | Test Status
PR-01 | [Feature] | US-01 | Done when: [testable condition] | Not started
PR-02 | [Feature] | US-02 | Done when: [testable condition] | Not started
---
19. REVISION HISTORY
Version | Date | Author | Changes Made
v1.0 | \${currentDate} | \${creatorName} | Initial draft
---
20. APPROVAL & SIGN-OFF
Auto-populate from source stakeholders:
Reviewer Name | Role | Status | Date | Comments`;
    } else if (baseTemplate === 'enterprise' && outputType === 'CRD') {
      templateText = `Document Title: CRD — \${projectName}
Change Request ID: CR-[Auto-generate or enter]
Project Name: \${projectName}
Author / Requestor: \${creatorName}
Date of Request: \${currentDate}
Version: \${version}
Status: \${status}
Original Document Reference: [BRD/FRD/PRD version this change applies to]

1. CHANGE OVERVIEW & SUMMARY
Derived from change trigger and source:
- Summarize what is changing in 2–3 sentences
- Extract which part of the approved project this change touches
- Auto-assess urgency
---
2. REASON FOR CHANGE
Extracted from source and trigger:
- Identify the root cause
- Pull any supporting evidence from source
- Identify who flagged this need
- Note when it was identified
---
3. CURRENT STATE DESCRIPTION
Auto-fill from source:
- Extract the original approved state
- Reference original IDs from BRD / FRD / PRD
- Describe what is currently working vs. what is failing or insufficient
---
4. PROPOSED CHANGE DESCRIPTION
Derived from change trigger and source gaps:
- Describe precisely what will be different after the change
- Map the delta
- List which source documents, sections, or IDs will need to be updated
- Flag if wireframes, diagrams, or updated specs are needed
---
5. CHANGE CATEGORY & TYPE
Auto-classify based on source content and change trigger:

Category:
☐ Scope Change
☐ Budget / Cost Change
☐ Timeline / Schedule Change
☐ Quality / Requirement Change
☐ Resource Change
☐ Technical Change
☐ Regulatory / Compliance Change
☐ Risk-Driven Change

Change Type: 
Justification: 
---
6. PRIORITY & URGENCY
Auto-derive from source timeline, risks, and project phase:
- Assign priority
- Map to nearest source milestone
- Flag if this change blocks a HIGH priority requirement
---
7. IMPACT ANALYSIS
Derived from source scope, budget, timeline, constraints, and risk sections:

Dimension        | Impact Level     | Source-Derived Details
Scope            | | 
Cost/Budget      | | 
Timeline         | | 
Quality          | | 
Resources        | | 
Risk             | | 
Existing Reqs    | | 
Other Systems    | | 

Overall Impact Rating: [Auto-assess: High / Medium / Low]
Risk Score: [Count of High-impact dimensions above — e.g. 3/8 dimensions = High Risk]
---
8. OPTIONS ANALYSIS
Auto-generate from source context and change trigger:

Option A — Do Nothing:
- Pros: 
- Cons/Consequences: 
- Recommended: No

Option B — Proposed Change (Recommended):
- Pros: 
- Cons/Risks: 
- Recommended: Yes

Option C — Alternative:
---
9. BENEFITS OF CHANGE
Derived from source project objectives and goals:
- Extract how this change moves the project closer to source-stated objectives
- Quantify benefits
- Map benefits to specific stakeholders
---
10. CONSEQUENCES OF NOT CHANGING
Derived from source risk section, constraints, and objectives:
- State consequences for each HIGH priority requirement affected
- Derive timeline, budget, or quality risk of rejection
- Flag if inaction breaches a compliance or security constraint
---
11. AFFECTED REQUIREMENTS & TRACEABILITY
Auto-generate from source requirement IDs:

Original Req ID | Title (from source) | Current State | New State After Change | Doc/Version
[FR-01] | [Requirement name] | [Current approved text] | [Revised text after change] | [BRD v1.2]
[Flag any requirement that becomes obsolete]
---
12. STAKEHOLDERS CONSULTED
Auto-populate from source stakeholder section:

Name | Role | Input Provided | Date Consulted
---
13. RESOURCE & COST ESTIMATE
Derived from source budget, timeline, and team structure:
- Extract original budget from source
- Estimate effort delta
- Flag if change exceeds constraints

Effort Estimate:
- Development: 
- Design: 
- QA: 
- Total: 

Cost Estimate:
- Total change cost: 
- Source approved budget: 
- Variance: 
---
14. IMPLEMENTATION PLAN
Derived from source scope, timeline, and team structure:
Step | Action | Owner | Target Date | Status
---
15. ROLLBACK PLAN
Derived from source risk and constraints:
- Rollback Trigger: 
- Rollback Steps: 
- Rollback Owner: 
- Recovery Time Estimate: 
- Data Impact: 
---
16. TESTING & VALIDATION REQUIREMENTS
Derived from source acceptance criteria and scope:
- Auto-list test cases for each affected requirement
- Identify which source acceptance criteria must be re-validated
- Derive UAT owner
- Restate acceptance criteria for the changed items
---
17. COMMUNICATION PLAN
Derived from source stakeholder and communication context:
Audience | Message | Channel | Owner | Timing
---
18. LESSONS LEARNED
Auto-derive from source history and change trigger:
- What requirement was incomplete or ambiguous?
- Which constraint or assumption was incorrect?
- What review process would have caught this earlier?
---
19. REVISION HISTORY
Version | Date | Author | Changes Made
v1.0 | \${currentDate} | \${creatorName} | Initial CRD
---
20. APPROVAL & SIGN-OFF
Auto-populate from source stakeholder and approval sections:

Reviewer Name | Role | Decision | Date | Conditions

Change Control Board Decision: Pending
CCB Decision Date:
Escalation Path: [Who reviews if CCB cannot reach consensus]
Conditions (if any): [Any conditions attached to approval]`;
    } else {
      if (outputType === 'BRD') {
        templateText = `Document Title: BRD — \${projectName}
Project Name: \${projectName}
Author / Created By: \${creatorName}
Date: \${currentDate}
Version: \${version}
Status: \${status}

1. EXECUTIVE SUMMARY
---
2. PROJECT OBJECTIVES
---
3. NEEDS STATEMENT
---
4. PROJECT SCOPE
In-Scope:
-

Out-of-Scope:
-
---
5. CURRENT VS. PROPOSED PROCESS
Current Process:

Proposed Process:
---
6. REQUIREMENTS
- HIGH:
- HIGH:
- MEDIUM:
- LOW:
---
7. KEY STAKEHOLDERS
Name | Role | Project Impact
---
8. ASSUMPTIONS & CONSTRAINTS
Assumptions:
- A1:

Constraints:
- Budget:
- Timeline:
- Security:
---
9. COST-BENEFIT ANALYSIS
Costs:
- Explicit:
- Implicit:

Benefits:
- Explicit:
- Implicit:
---
10. SIGN-OFF
Reviewer Name | Role | Status | Date | Comments`;
      } else if (outputType === 'PRD') {
        templateText = `Document Title: PRD — \${projectName}
Project Name: \${projectName}
Author / Created By: \${creatorName}
Date: \${currentDate}
Version: \${version}
Status: \${status}

1. PRODUCT OVERVIEW & PURPOSE
---
2. PROBLEM STATEMENT
---
3. GOALS & SUCCESS METRICS
Metric | Target | Measurement Method | Timeline
[e.g. Active users] | [+20%] | [Analytics] | [3 months post-launch]
---
4. TARGET USERS & MARKET ASSESSMENT
---
5. USER PERSONAS
Persona Name: | Role: | Goals: | Pain Points: | How product helps:
---
6. USER STORIES & USE CASES
"As a [role], I want to [action], so that [benefit]."
US-01:
UC-01 | Actor | Trigger | Main Flow | Expected Outcome
---
7. PRODUCT FEATURES & FUNCTIONAL REQUIREMENTS
PR-ID | Feature Name | Description | Priority (P0/P1/P2) | Persona
Priority: P0 = Must Have, P1 = Should Have, P2 = Nice to Have
---
8. NON-FUNCTIONAL REQUIREMENTS
NFR-01 | Performance | [e.g. Page load < 2s, API response < 500ms]
NFR-02 | Security | [e.g. Auth required, PII encrypted at rest]
NFR-03 | Reliability | [e.g. 99.9% uptime SLA]
NFR-04 | Scalability | [e.g. Support N concurrent users]
---
9. TECHNICAL REQUIREMENTS
---
10. UX / DESIGN REQUIREMENTS
---
11. ASSUMPTIONS & OPTIONS
---
12. DEPENDENCIES
---
13. CONSTRAINTS & OUT-OF-SCOPE
Constraints:
- Timeline: [Hard deadline or phase window]
- Budget: [Cost ceiling or resource limit]
- Technical: [Stack, platform, or architectural limit]
- Team: [Skill gaps or headcount constraints]

Out-of-Scope:
- [Feature or capability explicitly excluded + reason]
---
14. RELEASE PLAN & MILESTONES
Phase | Milestone | Owner | Target Date | Status
Discovery | Problem validated | PM | |
Design | Wireframes approved | Designer | |
Development | Feature complete | Tech Lead | |
QA | Tests passed | QA Lead | |
Launch | Feature shipped | PM | |
---
15. OPEN QUESTIONS
---
16. RISKS
Risk ID | Description | Likelihood | Impact | Mitigation
R-01 | | High / Med / Low | High / Med / Low |
---
17. SUPPORT & ENVIRONMENTAL REQUIREMENTS
---
18. TRACEABILITY & ACCEPTANCE CRITERIA
PR-ID | Feature | Linked User Story | Acceptance Criteria | Test Status
PR-01 | | US-01 | Done when: [testable condition] | Not started
---
19. REVISION HISTORY
Version | Date | Author | Changes Made
v1.0 | \${currentDate} | \${creatorName} | Initial draft
---
20. APPROVAL & SIGN-OFF`;
      } else if (outputType === 'CRD') {
        templateText = `Document Title: CRD — \${projectName}
Change Request ID: CR-[Auto-generate or enter]
Project Name: \${projectName}
Author / Requestor: \${creatorName}
Date of Request: \${currentDate}
Version: \${version}
Status: \${status}
Original Document Reference: [BRD/FRD/PRD this change applies to]

1. CHANGE OVERVIEW & SUMMARY
---
2. REASON FOR CHANGE
---
3. CURRENT STATE DESCRIPTION
---
4. PROPOSED CHANGE DESCRIPTION
---
5. CHANGE CATEGORY & TYPE
---
6. PRIORITY & URGENCY
---
7. IMPACT ANALYSIS
Dimension | Impact Level | Details
Scope | |
Cost/Budget | |
Timeline | |
Quality | |
Resources | |
Risk | |
---
8. OPTIONS ANALYSIS
---
9. BENEFITS OF CHANGE
---
10. CONSEQUENCES OF NOT CHANGING
---
11. AFFECTED REQUIREMENTS & TRACEABILITY
Original Req ID | Title | Current State | New State | Doc/Version
---
12. STAKEHOLDERS CONSULTED
Name | Role | Input Provided | Date Consulted
---
13. RESOURCE & COST ESTIMATE
---
14. IMPLEMENTATION PLAN
Step | Action | Owner | Target Date | Status
---
15. ROLLBACK PLAN
---
16. TESTING & VALIDATION REQUIREMENTS
---
17. COMMUNICATION PLAN
Audience | Message | Channel | Owner | Timing
---
18. LESSONS LEARNED
---
19. REVISION HISTORY
Version | Date | Author | Changes Made
v1.0 | \${currentDate} | \${creatorName} | Initial CRD
---
20. APPROVAL & SIGN-OFF
Reviewer Name | Role | Decision | Date | Conditions
Change Control Board Decision: Pending
CCB Decision Date:
Escalation Path:`;
      } else if (outputType === 'FRD') {
        templateText = `Document Title: FRD — \${projectName}
Project Name: \${projectName}
Author / Created By: \${creatorName}
Date: \${currentDate}
Version: \${version}
Status: \${status}

1. INTRODUCTION & PURPOSE
---
2. SCOPE
---
3. GLOSSARY & TERMINOLOGY
---
4. SYSTEM OVERVIEW
---
5. USER ROLES & PERMISSIONS
---
6. FUNCTIONAL REQUIREMENTS
ID | Title | The system shall [action] when [condition] | Priority | Source Reference
FR-01 | | The system shall... | High |
FR-02 | | The system shall... | Medium |
Use "shall" for mandatory, "should" for recommended.
---
7. NON-FUNCTIONAL REQUIREMENTS
NFR-01 | Performance | [e.g. API response < 2s under load]
NFR-02 | Security | [e.g. All PII data encrypted at rest]
NFR-03 | Reliability | [e.g. 99.9% uptime SLA]
NFR-04 | Scalability | [e.g. Support 10,000 concurrent users]
---
8. USE CASES & USER STORIES
UC-01 | [Actor] | [Trigger] | [Main Flow] | [Expected Outcome]
"As a [role], I want to [action], so that [benefit]."
---
9. PROCESS FLOWS & WORKFLOWS
Process Name:
Trigger:
Steps: Step 1 → Step 2 → Step 3 → End state
Systems Involved:
---
10. UI/UX REQUIREMENTS
Screen / Page | Key Components | Behavior on Interaction | Validation Rules
---
11. DATA REQUIREMENTS
- Inputs:
- Outputs:
- Storage:
- Validation Rules:
- Retention Policy:
---
12. INTERFACE REQUIREMENTS
- User Interfaces: [Web / Mobile / Desktop]
- External APIs:
- Internal Systems:
- Communication: [Webhooks / Email / SMS]
---
13. ERROR HANDLING & EDGE CASES
ERR-ID | Scenario | System Response | Recovery Path
ERR-01 | | |
---
14. ACCEPTANCE CRITERIA
- FR-01 is complete when: [specific, testable condition]
- FR-02 is complete when: [specific, testable condition]
---
15. ASSUMPTIONS & DEPENDENCIES
- Assumption:
- Dependency:
---
16. CONSTRAINTS
- Technical:
- Timeline:
- Budget:
- Regulatory:
---
17. TRACEABILITY MATRIX
Requirement ID | Requirement Title | Linked Business Objective | Test Case ID | Status
FR-01 | | | TC-01 | Not tested
---
18. REVISION HISTORY
Version | Date | Author | Summary of Changes
v1.0 | \${currentDate} | \${creatorName} | Initial draft
---
19. APPROVAL & SIGN-OFF
Reviewer Name | Role | Status (Approved / Pending / Rejected) | Date | Comments
[Name] | [Role] | Pending | |
[Name] | [Role] | Pending | |`;
      } else {
        templateText = `Document Title: ${outputType} — \${projectName}
Project Name: \${projectName}
Author: \${creatorName}
Date: \${currentDate}
Version: \${version}
Status: \${status}

1. EXECUTIVE SUMMARY
---
2. OBJECTIVES
---
3. SCOPE
In-Scope:
-

Out-of-Scope:
-
---
4. REQUIREMENTS
- HIGH:
- MEDIUM:
- LOW:
---
5. NON-FUNCTIONAL REQUIREMENTS
NFR-01 | Type | Requirement
---
6. ASSUMPTIONS & CONSTRAINTS
- Assumption:
- Constraint:
---
7. SIGN-OFF
Reviewer Name | Role | Status | Date | Comments`;
      }
    }

    const parsedTemplate = templateText
      .replace(/\$\{projectName\}/g, projectName?.trim() || 'Untitled Project')
      .replace(/\$\{creatorName\}/g, creatorName?.trim() || 'DocForge User')
      .replace(/\$\{currentDate\}/g, today)
      .replace(/\$\{version\}/g, 'v1.0')
      .replace(/\$\{status\}/g, 'Draft');


    // ---------------------------------------------------------
    // Stage 3: LLM Generation
    // ---------------------------------------------------------
    if (processingMode === 'bulk') {
      onProgress(60, 'Stage 3: Generating Document (Comprehensive Mode)...');
      
      const systemPrompt = `${ENTERPRISE_SYSTEM_PROMPT}
Map the compiled source data into the exact template provided. Do not generate multiple alternate versions.
Output strict Markdown. Include Mermaid.js syntax blocks (\`\`\`mermaid) to visualize any workflows mentioned in the source data.
CRITICAL: Do not generate a title or metadata block at the top of the document. Do not output 'DOCUMENT METADATA'. Start immediately with Section 1.
DO NOT summarize aggressively. Expand on all points exhaustively. Utilize all available template fields. Ensure the final output is highly detailed and comprehensive.`;

      const userPrompt = `--- TEMPLATE STRUCTURE ---
    ${parsedTemplate}

--- COMPILED SOURCE FILE ---
    ${compiledMarkdown}`;

      const totalPromptSize = compiledMarkdown.length + parsedTemplate.length;
      if (totalPromptSize > 28000) {
        throw new Error("Source data is too large for Comprehensive Mode. This will crash your local AI. Please switch your Processing Strategy to 'Section-by-Section (Semantic Injection)'.");
      }

      const aiContent = await generateCompletion(llmConfig, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], 0.3, signal);

      const mermaidBlocks: string[] = [];
      const contentWithPlaceholders = aiContent.replace(
        /```mermaid[\s\S]*?```/g,
        (match) => {
          mermaidBlocks.push(match);
          return `%%MERMAID_BLOCK_${mermaidBlocks.length - 1}%%`;
        }
      );
      const sanitizedContent = safeSanitize(contentWithPlaceholders);
      const cleanContent = sanitizedContent.replace(
        /%%MERMAID_BLOCK_(\d+)%%/g,
        (_, i) => mermaidBlocks[parseInt(i)]
      );
      
      onProgress(90, 'Stage 4: Assembling final document...');
      const parts = cleanContent.split(/(?=^#+\s)/m);
      
      for (const part of parts) {
        if (!part.trim()) continue;
        const lines = part.trim().split('\n');
        const headerLine = lines[0];
        const body = lines.slice(1).join('\n').trim();
        
        if (headerLine.match(/^#+\s/)) {
          sections.push({
            header: headerLine.replace(/^#+\s*/, ''),
            content: body
          });
        } else {
          if (sections.length === 0) {
            sections.push({ header: 'Overview', content: part.trim() });
          } else {
            sections[sections.length - 1].content += '\n\n' + part.trim();
          }
        }
      }

      if (sections.length === 0) {
        sections.push({ header: `${outputType} Document`, content: cleanContent });
      }

      // Count clarification tags across all sections
      const clarificationCount = sections.reduce((count, sec) => {
        const matches = sec.content.match(/\[CLARIFICATION NEEDED:/g);
        return count + (matches ? matches.length : 0);
      }, 0);
      if (clarificationCount > 0) {
        sections.push({
          header: '⚠️ Clarifications Required',
          content: `**This document contains ${clarificationCount} item(s) that require stakeholder input before finalizing.**\n\nSearch for \`[CLARIFICATION NEEDED:\` throughout this document to locate each item. Each tag indicates a gap in the source material that must be resolved before this document can be approved.`
        });
      }
    } else {
      // ---------------------------------------------------------
      // Semantic Mode
      // ---------------------------------------------------------
      onProgress(45, 'Stage 2.5: Generating Global Summary for Anchor...');
      const totalLen = compiledContext.length;
      const sampleSize = 2000;
      const openingSample = compiledContext.slice(0, sampleSize);
      const midPoint = Math.floor(totalLen / 2);
      const midStart = Math.max(0, midPoint - Math.floor(sampleSize / 2));
      const midEnd = Math.min(totalLen, midPoint + Math.floor(sampleSize / 2));
      const middleSample = compiledContext.slice(midStart, midEnd);

      // Only include closing sample if context is long enough to avoid overlap
      const closingSample = totalLen > sampleSize * 3
        ? compiledContext.slice(totalLen - sampleSize)
        : '';

      const sampleText = closingSample
        ? `[OPENING SECTION]:
${openingSample}

[MIDDLE SECTION]:
${middleSample}

[CLOSING SECTION]:
${closingSample}`
        : `[OPENING SECTION]:
${openingSample}

[MIDDLE SECTION]:
${middleSample}`;

      const summaryFocusByType: Record<string, string> = {
        BRD: `Focus your summary on: the business problem, proposed solution,
          key stakeholders, high-level budget/timeline constraints, and
          expected business outcomes. This summary will anchor a BRD.`,
        FRD: `Focus your summary on: the system being built or modified,
          its primary user roles, core functional requirements, key
          integrations, and non-functional constraints. This summary
          will anchor an FRD.`,
        PRD: `Focus your summary on: the target users, the product being
          built, key features, success metrics, and market context.
          This summary will anchor a PRD.`,
        CRD: `Focus your summary on: what change is being requested,
          what the original approved state was, who requested the
          change, why it is needed, and what the impact is.
          This summary will anchor a CRD.`,
      };

      const summaryFocus = summaryFocusByType[outputType] || summaryFocusByType.BRD;

      const globalSummaryPrompt = `Based on the following extracted text,
      create a structured anchor summary for a ${outputType} document.

      ${summaryFocus}

      Also capture: primary actors/stakeholders, key constraints (budget,
      timeline, technical), and any explicit goals or success criteria found
      in the source.

      SOURCE DATA:
      ${sampleText}`;

      const globalSummary = await generateCompletion(llmConfig, [
        { role: 'system', content: `You are an expert ${outputType} Business Analyst.` },
        { role: 'user', content: globalSummaryPrompt }
      ], 0.4, signal);

      let headerList: string[] = [];
      if (parsedTemplate.includes('\n---\n')) {
        headerList = parsedTemplate
          .split(/\n---\n/)
          .map(s => s.trim())
          .filter(s => s.length > 0);
      } else {
        headerList = parsedTemplate
          .split('\n')
          .filter(line => line.trim().length > 0);
      }
      
      const METADATA_PREFIXES = [
        'Document Title:',
        'Project Name:',
        'Change Request ID:',
        'Author',
        'Date',
        'Version:',
        'Status:',
        'Original Document Reference:',
      ];

      for (let i = 0; i < headerList.length; i++) {
        const sectionDefinition = headerList[i];
        const headerTitle = sectionDefinition.split('\n')[0].replace(/^#+\s*/, '');

        const isMetadataBlock = METADATA_PREFIXES.some(prefix =>
          headerTitle.trim().startsWith(prefix)
        );

        if (isMetadataBlock) continue;

        const progressPercent = 50 + Math.floor((i / headerList.length) * 40);
        onProgress(progressPercent, `Stage 3: Generating section: ${headerTitle}...`);

        if (signal?.aborted) {
          const err = new Error('AbortError');
          err.name = 'AbortError';
          throw err;
        }

        try {
          const context = await executeWorker('SEARCH_DB', { query: sectionDefinition, limit: 3 });
        
          const sectionPrompt = `You are writing the following section of a ${outputType} document.
        
SECTION DEFINITION & REQUIREMENTS:
      ${sectionDefinition}

GLOBAL CONTEXT (Use for background understanding):
      ${globalSummary}

RELEVANT SOURCE DATA:
      ${context}

      TEMPLATE METADATA:
      - Project: ${projectName?.trim() || 'Untitled Project'}
      - Author: ${creatorName?.trim() || 'DocForge User'}
      - Date: ${today}

INSTRUCTIONS:
1. Write the content for this section based ONLY on the source data provided.
2. Output ONLY the content for this section. Do NOT include the section header/title at the top of your output. Structure the body exactly as requested in the SECTION DEFINITION.
3. Output strict Markdown. Use professional, executive, and analytical tone.
4. Adapt language, metrics, and priorities based on the actual project context.
5. Do not invent features. If data is missing to fulfill the requirements of this specific section, explicitly write [CLARIFICATION NEEDED: {Brief description of missing info}].
6. If writing functional requirements (FRD), use "shall" for binding functions and "should" for non-binding ones. Each requirement must be specific, testable, and traceable.
7. If writing product requirements (PRD), write from the product perspective — focus on WHAT the product does, WHO it is for, and WHY it exists. Keep requirements clear, specific, and testable. Use plain language.
8. If writing change requirements (CRD), be precise, factual, and impact-focused. Every change must be justified, analyzed, and formally approved before execution.
9. CRITICAL: Do not generate a title or metadata block at the top of the document. Do not output 'DOCUMENT METADATA'. Start immediately with Section 1.
10. DO NOT summarize aggressively. Expand on all points exhaustively. Utilize all available template fields. Ensure the final output is highly detailed and comprehensive.
11. CRITICAL CONSTRAINT: You must output ONLY the final, client-ready content for this section. DO NOT echo back the section title, DO NOT output 'SECTION DEFINITION', 'GLOBAL CONTEXT', or any internal instructions. Start directly with the professional content.`;

        const sectionContent = await generateCompletion(llmConfig, [
          { role: 'system', content: `${ENTERPRISE_SYSTEM_PROMPT}\nYou are writing ONLY the specific section requested. Do not generate the entire document. Do not output the section title.` },
          { role: 'user', content: sectionPrompt }
        ], 0.3, signal);
        
        const mermaidBlocksSec: string[] = [];
        const secWithPlaceholders = sectionContent.replace(
          /```mermaid[\s\S]*?```/g,
          (match) => {
            mermaidBlocksSec.push(match);
            return `%%MERMAID_BLOCK_${mermaidBlocksSec.length - 1}%%`;
          }
        );
        const sanitizedSec = safeSanitize(secWithPlaceholders);
        const cleanContent = sanitizedSec.replace(
          /%%MERMAID_BLOCK_(\d+)%%/g,
          (_, i) => mermaidBlocksSec[parseInt(i)]
        );
        
        sections.push({ header: headerTitle, content: cleanContent });
        } catch (sectionError: any) {
          if (sectionError.name === 'AbortError') throw sectionError;
          sections.push({
            header: headerTitle,
            content: `[GENERATION ERROR: This section could not be generated. Error: ${sectionError.message}. Please re-run generation or fill this section manually.]`
          });
        }
      }
      onProgress(90, 'Stage 4: Assembling final document...');

      // Count clarification tags across all sections
      const clarificationCount = sections.reduce((count, sec) => {
        const matches = sec.content.match(/\[CLARIFICATION NEEDED:/g);
        return count + (matches ? matches.length : 0);
      }, 0);
      if (clarificationCount > 0) {
        sections.push({
          header: '⚠️ Clarifications Required',
          content: `**This document contains ${clarificationCount} item(s) that require stakeholder input before finalizing.**\n\nSearch for \`[CLARIFICATION NEEDED:\` throughout this document to locate each item. Each tag indicates a gap in the source material that must be resolved before this document can be approved.`
        });
      }
    }

    // ---------------------------------------------------------
    // Stage 4.5: Editorial Polish
    // ---------------------------------------------------------
    if (applyPolish) {
      const getSectionPolishRules = (header: string): string => {
        const h = header.toUpperCase();
        if (h.includes('EXECUTIVE SUMMARY') || h.includes('OVERVIEW') || h.includes('PURPOSE')) {
          return `
SECTION RULE: This is an introductory section. Tighten to 3–5 crisp
sentences. Remove any repetition of later sections' content.`;
        }
        if (h.includes('ROLLBACK') || h.includes('ERROR') || h.includes('EDGE CASE') || h.includes('RECOVERY')) {
          return `
SECTION RULE: This is a technical resilience section. Preserve all
steps, triggers, owners, and technical conditions. Do not summarize steps.`;
        }
        if (h.includes('SIGN-OFF') || h.includes('APPROVAL') || h.includes('REVISION HISTORY')) {
          return `
SECTION RULE: This is a formal control section. Preserve all table
rows, column headers, and placeholder fields exactly. Do not add or remove rows.`;
        }
        if (h.includes('TRACEABILITY') || h.includes('MATRIX')) {
          return `
SECTION RULE: This is a traceability table. Preserve every row and
column exactly. Only fix typos in text cells — never alter IDs or status values.`;
        }
        if (h.includes('RISK') || h.includes('ASSUMPTION') || h.includes('CONSTRAINT')) {
          return `
SECTION RULE: This is a risk/constraint section. Preserve all risk
IDs, likelihood ratings, impact levels, and mitigation strategies. Do not merge risks.`;
        }
        if (h.includes('COST') || h.includes('BUDGET') || h.includes('FINANCIAL')) {
          return `
SECTION RULE: This is a financial section. Preserve all figures,
currencies, percentages, and ROI calculations exactly as written.`;
        }
        return '';
      };

      const getPolishPrompt = (docType: string, sectionHeader: string): string => {
        const baseRules = `
UNIVERSAL POLISH RULES:
1. Remove duplicate ideas, repeated phrases, and AI-style filler language.
2. Improve grammar, readability, and professional tone without changing
   meaning or removing factual content.
3. Standardize headings, numbering, and terminology within this section.
4. CRITICAL — PRESERVE EXACTLY AS-IS (do not rewrite, remove, or alter):
   a. Any text matching [CLARIFICATION NEEDED: ...] — these are required flags
   b. Any text matching [GENERATION ERROR: ...] — these are error placeholders
   c. Any text matching [AMBIGUOUS: ...] — these are source ambiguity flags
   d. Any markdown table (lines starting and ending with |) — preserve all
      pipe characters, column structure, and cell content exactly
   e. Any code block including \`\`\`mermaid blocks — preserve verbatim
5. Output ONLY the polished section content. Do not add a title, section
   number, or any commentary.`;

        const docTypeRules: Record<string, string> = {
          BRD: `
BRD-SPECIFIC RULES:
- Preserve all business outcome language ("the business requires", "the
  organization shall"). Do not convert to system/technical language.
- Requirements must remain outcome-focused, not implementation-focused.
- Preserve all cost/benefit figures, ROI estimates, and financial data exactly.
- Do not merge separate business requirements into combined statements.`,

          FRD: `
FRD-SPECIFIC RULES:
- Preserve "shall" for mandatory requirements and "should" for optional ones.
  Do not convert "shall" to "should" or vice versa.
- Keep each requirement atomic — do not merge two separate FR items.
- Preserve all condition clauses ("when [X], the system shall [Y]").
- Preserve all table structures for traceability matrix, error handling,
  and use case tables exactly as formatted.`,

          PRD: `
PRD-SPECIFIC RULES:
- Preserve all user story format: "As a [role], I want [action], so that
  [benefit]." Do not convert to "shall" statement format.
- Preserve P0/P1/P2 priority labels on all features.
- Preserve all persona names and their attributes.
- Do not convert feature descriptions into system requirements language.
- Keep the product voice — features should describe WHAT the product does
  for users, not HOW the system implements it.`,

          CRD: `
CRD-SPECIFIC RULES:
- Preserve all change justification evidence — do not summarize or remove
  the "reason for change" or "root cause" details.
- Preserve the current-state vs proposed-state delta for every changed item.
- Preserve all impact assessment values (High/Medium/Low ratings) exactly.
- Do not remove option analysis rows — even rejected options must remain.
- Preserve all stakeholder consultation records and CCB decision fields.`,
        };

        const sectionRules = getSectionPolishRules(sectionHeader);

        return `You are a senior technical editor performing a precision editorial
pass on a single section of a ${docType} document.

${baseRules}
${docTypeRules[docType] || docTypeRules.BRD}
${sectionRules}`;
      };

      const SKIP_POLISH_HEADERS = [
        '⚠️ clarifications required',
        'revision history',
        'approval & sign-off',
        'sign-off',
      ];

      const polishableSections = sections.filter(s =>
        !SKIP_POLISH_HEADERS.some(h =>
          s.header.toLowerCase().includes(h.toLowerCase())
        ) && s.content.length > 200
      );
      const polishableCount = polishableSections.length;
      let polishIndex = 0;

      for (let i = 0; i < sections.length; i++) {
        if (signal?.aborted) {
          const err = new Error('AbortError');
          err.name = 'AbortError';
          throw err;
        }

        const section = sections[i];

        // FIX 14.3/14.7 — Skip protected sections and short content
        const shouldSkip = SKIP_POLISH_HEADERS.some(h =>
          section.header.toLowerCase().includes(h.toLowerCase())
        );
        if (shouldSkip || section.content.length <= 200) continue;

        // FIX 14.10 — Accurate progress reporting
        const progressPercent = 90 + Math.floor((polishIndex / Math.max(polishableCount, 1)) * 9);
        onProgress(
          progressPercent,
          `Stage 5: Editorial Polish — ${section.header} (${polishIndex + 1} of ${polishableCount})...`
        );

        // FIX 14.9 — Pre/post content change tracking
        const originalContent = section.content;
        const originalLength = originalContent.length;

        // FIX 14.5 — Protect Mermaid blocks during polish
        const mermaidBlocksPol: string[] = [];
        const contentForPolish = section.content.replace(
          /```mermaid[\s\S]*?```/g,
          (match) => {
            mermaidBlocksPol.push(match);
            return `%%MERMAID_BLOCK_${mermaidBlocksPol.length - 1}%%`;
          }
        );

        const polishedContent = await generateCompletion(llmConfig, [
          { role: 'system', content: getPolishPrompt(outputType, section.header) },
          { role: 'user', content: contentForPolish }
        ], 0.3, signal);

        const restoredContent = polishedContent.replace(
          /%%MERMAID_BLOCK_(\d+)%%/g,
          (_, i) => mermaidBlocksPol[parseInt(i)]
        );

        // Compute sanitized polished value BEFORE deciding whether to accept it
        const sanitizedPolished = safeSanitize(restoredContent);
        const polishedLength = sanitizedPolished.length;
        const shrinkageRatio = originalLength > 0
          ? (originalLength - polishedLength) / originalLength
          : 0;

        // Assign section.content exactly once based on decision
        if (shrinkageRatio > 0.4) {
          console.warn(
            `[DocForge Polish] Section "${section.header}" shrank by ` +
            `${Math.round(shrinkageRatio * 100)}%. Reverting to pre-polish content.`
          );
          // Note: header is cleaned unconditionally even on revert — this is intentional.
          section.content = safeSanitize(originalContent);
        } else {
          section.content = sanitizedPolished;
        }

        // FIX 14.2 — Clean section header (unconditional — even reverted sections get a clean header)
        const cleanedHeader = section.header
          .replace(/^#+\s*/, '')
          .replace(/\s*[-—]\s*Auto-generated\s*$/i, '')
          .replace(/\s*[-—]\s*Draft\s*$/i, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (cleanedHeader.length > 0) {
          section.header = cleanedHeader;
        }

        polishIndex++;
      }
    }

    // ---------------------------------------------------------
    // Stage 5: Return structured data
    // ---------------------------------------------------------
    onProgress(100, 'Done! Content Generated.');
    return { success: true, data: { projectName, creatorName, outputType, sections } };
  } catch (error: any) {
    console.error(error);
    let reason: Extract<GenerationResult, { success: false }>['reason'] = 'api-error';
    if (error.name === 'AbortError') reason = 'aborted';
    else if (error.message.includes('too large')) reason = 'context-too-large';
    else if (error.message.includes('template')) reason = 'template-error';
    onProgress(100, `Error: ${error.message}`);
    return {
      success: false,
      reason,
      message: error.message,
      partialSections: sections.length > 0 ? sections : undefined
    };
  }
}

export async function generateDocx(data: GeneratedData): Promise<Blob> {
  return await executeWorker('GENERATE_DOCX', { data });
}

export async function generatePdf(data: GeneratedData): Promise<Blob> {
  return await executeWorker('GENERATE_PDF', { data });
}
