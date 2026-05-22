import { generateCompletion, type LLMConfig } from '../llm';
import { executeWebSearch, type ResearchConfig } from '../researcher';
import { type GeneratedData, type GeneratedSection, type ProcessCallback, type GenerationResult } from '../processor';
import { useSwarmStore } from '../../store/useSwarmStore';
import { AGENT_PROMPTS } from './prompts';
import { getTemplateText } from './templateResolver';
import { loadFromCache, saveToCache, generateHash } from '../cacheStore';

export interface SwarmOptions {
  projectName: string;
  creatorName: string;
  compiledContext: string;
  outputType: string;
  baseTemplate?: string;
  templateFile?: File | null;
  llmConfig: LLMConfig;
  onProgress: ProcessCallback;
  signal?: AbortSignal;
  enableWebResearch?: boolean;
  researchConfig?: ResearchConfig;
}

export async function runSwarmGeneration(options: SwarmOptions): Promise<GenerationResult> {
  const { addLog } = useSwarmStore.getState();
  const { 
    projectName, creatorName, compiledContext, outputType, 
    baseTemplate, templateFile, llmConfig, onProgress, signal,
    enableWebResearch, researchConfig 
  } = options;

  let currentContext = compiledContext;
  const learningMemory = useSwarmStore.getState().learningMemory;
  const learningRulesText = learningMemory.length > 0 
    ? `\nCONTINUOUS LEARNING RULES (CRITICAL):\n${learningMemory.map(r => `- ${r}`).join('\n')}` 
    : '';

  try {
    const projId = projectName || 'default';
    const dataHash = await generateHash(currentContext + learningRulesText);

    // Step A: Researcher (if enabled)
    if (enableWebResearch && researchConfig) {
      const cachedResearch = await loadFromCache(projId, 'researcher', dataHash);
      if (cachedResearch) {
        addLog('Researcher', 'Loaded context enrichment from cache.', 'success');
        currentContext = cachedResearch;
        onProgress(30, '[Swarm] Loaded researched context from cache...');
      } else {
        addLog('Researcher', 'Analyzing context for missing industry standards...', 'thinking');
        onProgress(20, '[Swarm] Researcher analyzing context...');
        
        const researcherPrompt = `PROJECT: ${projectName}\nDOCUMENT TYPE: ${outputType}\n\nCONTEXT:\n${currentContext}\n\nOUTPUT NO_RESEARCH_NEEDED or a list of search queries.`;
        
        const researchDecision = await generateCompletion(llmConfig, [
          { role: 'system', content: AGENT_PROMPTS.Researcher },
          { role: 'user', content: researcherPrompt }
        ], 0.3, signal);

        if (!researchDecision.includes('NO_RESEARCH_NEEDED')) {
          const queries = researchDecision.split('\n').map(q => q.replace(/^-/, '').trim()).filter(q => q.length > 5).slice(0, 3);
          if (queries.length > 0) {
            addLog('Researcher', `Executing ${queries.length} searches to enrich context...`, 'info');
            onProgress(30, '[Swarm] Researcher fetching external data...');
            const researchResults = await executeWebSearch(queries, researchConfig);
            
            let researchOutput = `\n\n### SWARM RESEARCHER DATA ###\n`;
            for (const res of researchResults) {
              researchOutput += `#### Query: ${res.query}\n${res.results}\n\n`;
            }
            currentContext += researchOutput;
            addLog('Researcher', 'Successfully appended research data to context.', 'success');
            await saveToCache(projId, 'researcher', dataHash, currentContext);
          }
        } else {
          addLog('Researcher', 'Context is sufficient. No external research needed.', 'success');
        }
      }
    }

    // Resolve template
    addLog('System', 'Resolving document template...', 'info');
    onProgress(40, '[Swarm] Resolving template...');
    let templateText = await getTemplateText(outputType, baseTemplate, templateFile);
    
    // Replace metadata
    const today = new Date().toLocaleDateString('en-US');
    templateText = templateText
      .replace(/\$\{projectName\}/g, projectName?.trim() || 'Untitled Project')
      .replace(/\$\{creatorName\}/g, creatorName?.trim() || 'DocForge User')
      .replace(/\$\{currentDate\}/g, today)
      .replace(/\$\{version\}/g, 'v1.0')
      .replace(/\$\{status\}/g, 'Draft');

    // Step B: Strategist
    let outline: { header: string, instructions: string }[] = [];
    const cachedOutline = await loadFromCache(projId, 'strategist', dataHash + templateText);
    
    if (cachedOutline) {
      addLog('Strategist', 'Loaded outline from cache.', 'success');
      outline = cachedOutline;
      onProgress(50, '[Swarm] Loaded outline from cache...');
    } else {
      addLog('Strategist', 'Building detailed structural outline...', 'thinking');
      onProgress(50, '[Swarm] Strategist building outline...');
      
      const strategistPrompt = `TEMPLATE:\n${templateText}\n\nCONTEXT:\n${currentContext}\n\nOUTPUT a JSON array of objects with keys "header" and "instructions". Example: [{"header": "1. Executive Summary", "instructions": "Write a 3-sentence summary covering X, Y, Z."}]`;
      
      const strategistResponse = await generateCompletion(llmConfig, [
        { role: 'system', content: AGENT_PROMPTS.Strategist },
        { role: 'user', content: strategistPrompt }
      ], 0.2, signal);

      // Parse strategist JSON
      try {
        const jsonMatch = strategistResponse.match(/\[.*\]/s);
        const jsonStr = jsonMatch ? jsonMatch[0] : strategistResponse;
        outline = JSON.parse(jsonStr);
        addLog('Strategist', `Created outline with ${outline.length} sections.`, 'success');
        await saveToCache(projId, 'strategist', dataHash + templateText, outline);
      } catch (e) {
        addLog('Strategist', 'Failed to parse JSON outline. Falling back to template headers.', 'error');
        // Fallback: simple line split
        outline = templateText.split('\n').filter(l => l.match(/^[0-9]+\./)).map(l => ({ header: l, instructions: 'Draft this section based on template.' }));
      }
    }

    // Step C: Drafter & QA Loop (Parallel Execution)
    const generatedSections: GeneratedSection[] = [];
    let completedSections = 0;
    const CONCURRENCY_LIMIT = 3;

    // Helper for chunking
    const chunks = [];
    for (let i = 0; i < outline.length; i += CONCURRENCY_LIMIT) {
      chunks.push(outline.slice(i, i + CONCURRENCY_LIMIT));
    }

    for (const chunk of chunks) {
      const chunkPromises = chunk.map(async (section) => {
        addLog('Drafter', `Drafting section: ${section.header}...`, 'thinking');
        
        let draftContent = '';
        let isAccepted = false;
        let qaLoops = 0;
        let previousFeedback = '';

        while (!isAccepted && qaLoops < 2) {
          if (signal?.aborted) throw new Error('AbortError');
          
          const drafterPrompt = `SECTION TO DRAFT: ${section.header}\nINSTRUCTIONS: ${section.instructions}\n\nCONTEXT:\n${currentContext}${learningRulesText}${previousFeedback ? `\n\nQA FEEDBACK TO INCORPORATE:\n${previousFeedback}` : ''}`;
          
          draftContent = await generateCompletion(llmConfig, [
            { role: 'system', content: AGENT_PROMPTS.Drafter },
            { role: 'user', content: drafterPrompt }
          ], 0.4, signal);

          // QA Review
          addLog('QA Reviewer', `Critiquing draft for ${section.header}...`, 'thinking');
          const qaPrompt = `SECTION HEADER: ${section.header}\nSTRATEGIST INSTRUCTIONS: ${section.instructions}\n\nDRAFT TO REVIEW:\n${draftContent}\n\nCONTEXT AVAILABLE:\n${currentContext}${learningRulesText}`;
          
          const qaResponse = await generateCompletion(llmConfig, [
            { role: 'system', content: AGENT_PROMPTS.QAReviewer },
            { role: 'user', content: qaPrompt }
          ], 0.2, signal, true); // fastMode: true

          try {
            const qaResult = JSON.parse(qaResponse.match(/\{.*\}/s)?.[0] || qaResponse);
            if (qaResult.status === 'ACCEPT') {
              isAccepted = true;
              addLog('QA Reviewer', `Accepted section: ${section.header}.`, 'success');
            } else {
              qaLoops++;
              previousFeedback = qaResult.feedback;
              addLog('QA Reviewer', `Rejected section: ${section.header}. Reason: ${qaResult.feedback}`, 'warning');
            }
          } catch (e) {
            isAccepted = true;
            addLog('QA Reviewer', `Failed to parse QA output. Force-accepting ${section.header}.`, 'info');
          }
        }

        completedSections++;
        onProgress(50 + Math.floor((completedSections / outline.length) * 40), `[Swarm] Completed draft: ${section.header}...`);
        return { header: section.header.replace(/^#+\s*/, ''), content: draftContent };
      });

      const results = await Promise.allSettled(chunkPromises);
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
          generatedSections.push(result.value);
        } else {
          addLog('System', `Section failed completely: ${result.reason}`, 'error');
          generatedSections.push({ header: chunk[i].header, content: `[ERROR] Failed to generate section due to: ${result.reason}` });
        }
      }
    }

    // Step D: Local Verifier
    onProgress(95, '[Swarm] Local Verifier doing final polish...');
    addLog('Local Verifier', 'Performing final verification pass...', 'thinking');
    
    for (let i = 0; i < generatedSections.length; i++) {
      if (generatedSections[i].content.includes('CLARIFICATION NEEDED')) {
        const verifierPrompt = `FINAL PASS FOR SECTION: ${generatedSections[i].header}\n\nCONTENT:\n${generatedSections[i].content}\n\nCONTEXT:\n${currentContext}\n\nFix placeholders if context exists. Otherwise leave them. Output final text only.`;
        const polishedContent = await generateCompletion(llmConfig, [
          { role: 'system', content: AGENT_PROMPTS.LocalVerifier },
          { role: 'user', content: verifierPrompt }
        ], 0.1, signal, true); // fastMode: true
        generatedSections[i].content = polishedContent;
      }
    }
    addLog('Local Verifier', 'Final verification complete.', 'success');

    // Return the final payload
    const finalData: GeneratedData = {
      projectName: projectName || 'Untitled',
      creatorName: creatorName || 'User',
      outputType,
      sections: generatedSections
    };

    addLog('System', 'Swarm Generation complete!', 'success');
    return { success: true, data: finalData };

  } catch (error: any) {
    if (error.name === 'AbortError' || error.message === 'AbortError') {
      addLog('System', 'Swarm Generation aborted by user.', 'warning');
      return { success: false, reason: 'aborted', message: 'Aborted by user' };
    }
    addLog('System', `Error during generation: ${error.message}`, 'error');
    return { success: false, reason: 'api-error', message: error.message };
  }
}
