export async function getTemplateText(
  outputType: string,
  baseTemplate?: string,
  templateFile?: File | null
): Promise<string> {
  let templateText = '';

  if (templateFile) {
    try {
      templateText = await templateFile.text();
      return templateText;
    } catch (e) {
      console.warn('Failed to read template file. Falling back to default.');
    }
  }

  if (baseTemplate === 'enterprise' && outputType === 'BRD') {
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
3. BUSINESS PROBLEM & NEEDS STATEMENT
---
4. PROJECT SCOPE
In-Scope:
Out-of-Scope:
---
5. CURRENT STATE VS. PROPOSED FUTURE STATE
---
6. HIGH-LEVEL REQUIREMENTS
- HIGH:
- MEDIUM:
- LOW:
---
7. KEY STAKEHOLDERS
Name | Role | Project Impact
---
8. ASSUMPTIONS, DEPENDENCIES & CONSTRAINTS
---
9. COST-BENEFIT ANALYSIS
---
10. SIGN-OFF`;
  } else if (baseTemplate === 'enterprise' && outputType === 'PRD') {
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
---
4. TARGET USERS & MARKET ASSESSMENT
---
5. USER PERSONAS
---
6. USER STORIES & USE CASES
---
7. PRODUCT FEATURES & FUNCTIONAL REQUIREMENTS
---
8. NON-FUNCTIONAL REQUIREMENTS
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
---
14. RELEASE PLAN & MILESTONES
---
15. OPEN QUESTIONS
---
16. RISKS
---
17. SUPPORT & ENVIRONMENTAL REQUIREMENTS
---
18. TRACEABILITY & ACCEPTANCE CRITERIA
---
19. REVISION HISTORY
---
20. APPROVAL & SIGN-OFF`;
  } else if (baseTemplate === 'enterprise' && outputType === 'FRD') {
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
---
7. NON-FUNCTIONAL REQUIREMENTS
---
8. USE CASES & USER STORIES
---
9. PROCESS FLOWS & WORKFLOWS
---
10. UI/UX REQUIREMENTS
---
11. DATA REQUIREMENTS
---
12. INTERFACE REQUIREMENTS
---
13. ERROR HANDLING & EDGE CASES
---
14. ACCEPTANCE CRITERIA
---
15. ASSUMPTIONS & DEPENDENCIES
---
16. CONSTRAINTS
---
17. TRACEABILITY MATRIX
---
18. REVISION HISTORY
---
19. APPROVAL & SIGN-OFF`;
  } else if (baseTemplate === 'enterprise' && outputType === 'CRD') {
    templateText = `Document Title: CRD — \${projectName}
Change Request ID: CR-[Auto-generate or enter]
Project Name: \${projectName}
Author / Requestor: \${creatorName}
Date of Request: \${currentDate}
Version: \${version}
Status: \${status}

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
---
8. OPTIONS ANALYSIS
---
9. BENEFITS OF CHANGE
---
10. CONSEQUENCES OF NOT CHANGING
---
11. AFFECTED REQUIREMENTS & TRACEABILITY
---
12. STAKEHOLDERS CONSULTED
---
13. RESOURCE & COST ESTIMATE
---
14. IMPLEMENTATION PLAN
---
15. ROLLBACK PLAN
---
16. TESTING & VALIDATION REQUIREMENTS
---
17. COMMUNICATION PLAN
---
18. LESSONS LEARNED
---
19. REVISION HISTORY
---
20. APPROVAL & SIGN-OFF`;
  } else if (outputType === 'PRESENTATION') {
    templateText = `Slide 1: Title
[LAYOUT: TITLE_SLIDE]
- Title: \${projectName}
- Subtitle: Project Presentation
---
Slide 2: Overview
[LAYOUT: STANDARD_CONTENT]
- Title: Executive Overview
---
Slide 3: Problem Statement
[LAYOUT: TWO_COLUMN_SPLIT]
- Title: The Problem
---
Slide 4: Solution
[LAYOUT: STANDARD_CONTENT]
- Title: Proposed Solution
---
Slide 5: Timeline & Roadmap
[LAYOUT: FULL_WIDTH_VISUAL]
- Title: Project Timeline
---
Slide 6: Conclusion
[LAYOUT: TITLE_SLIDE]
- Title: Conclusion & Next Steps`;
  } else {
    // Default Fallback
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
---
4. REQUIREMENTS
---
5. NON-FUNCTIONAL REQUIREMENTS
---
6. ASSUMPTIONS & CONSTRAINTS
---
7. SIGN-OFF`;
  }

  return templateText;
}
