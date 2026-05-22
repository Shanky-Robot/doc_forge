import React, { useState } from 'react';
import { useSwarmStore } from '../store/useSwarmStore';
import { generateCompletion, type LLMConfig } from '../lib/llm';
import { type GeneratedData, type GeneratedSection } from '../lib/processor';
import { Check, Edit2, X, Brain } from 'lucide-react';

interface ReviewPanelProps {
  data: GeneratedData;
  llmConfig: LLMConfig;
  onFinalize: (finalData: GeneratedData) => void;
}

export const ReviewPanel: React.FC<ReviewPanelProps> = ({ data, llmConfig, onFinalize }) => {
  const [sections, setSections] = useState<GeneratedSection[]>(data.sections);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [feedback, setFeedback] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  
  const { addLearningRule } = useSwarmStore();

  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setEditContent(sections[index].content);
    setFeedback('');
  };

  const handleSaveEdit = async (index: number) => {
    const oldContent = sections[index].content;
    const newContent = editContent;

    const newSections = [...sections];
    newSections[index].content = newContent;
    setSections(newSections);
    setEditingIndex(null);

    // If there is meaningful feedback provided alongside the edit, extract a rule
    if (feedback.trim()) {
      await extractRule(oldContent, newContent, feedback);
    }
  };

  const extractRule = async (oldText: string, newText: string, userFeedback: string) => {
    setIsExtracting(true);
    try {
      const prompt = `You are a Continuous Learning System for an AI document generator.
The user rejected the following AI-generated draft and provided feedback.
ORIGINAL: ${oldText.substring(0, 500)}...
USER FEEDBACK: ${userFeedback}
NEW TEXT: ${newText.substring(0, 500)}...

Based on this, write a single, generalizable rule (max 1 sentence) for future document generation. Do not mention specific names or data, focus on style, tone, or structural preferences.
Example: "Always use bullet points for lists instead of paragraphs."`;
      
      const rule = await generateCompletion(llmConfig, [
        { role: 'system', content: 'You are a rule extraction engine.' },
        { role: 'user', content: prompt }
      ], 0.2);

      if (rule && rule.trim().length > 5) {
        addLearningRule(rule.trim());
      }
    } catch (e) {
      console.error("Failed to extract rule:", e);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleApproveAll = () => {
    onFinalize({ ...data, sections });
  };

  return (
    <div className="card mt-6 border-blue-500/30">
      <div className="flex justify-between items-center mb-4">
        <h2 className="card-title text-xl text-blue-400">
          <Brain size={24} className="mr-2 inline" />
          Swarm Review & Continuous Learning
        </h2>
        <button className="btn btn-primary bg-blue-600 hover:bg-blue-700" onClick={handleApproveAll}>
          <Check size={18} /> Approve & Finalize Document
        </button>
      </div>
      
      <p className="text-sm text-muted mb-6">
        Review the drafted sections below. Any edits or feedback you provide will be analyzed by the Swarm to update its Continuous Learning Memory for future documents.
      </p>

      {isExtracting && (
        <div className="bg-blue-900/30 border border-blue-500/30 text-blue-300 p-3 rounded mb-4 animate-pulse">
          Analyzing feedback and updating Swarm Memory...
        </div>
      )}

      <div className="flex flex-col gap-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
        {sections.map((section, index) => (
          <div key={index} className="border border-[var(--color-border)] rounded-md p-4 bg-[var(--color-surface)]">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-lg">{section.header}</h3>
              {editingIndex !== index && (
                <button className="btn btn-outline p-1" onClick={() => handleEdit(index)}>
                  <Edit2 size={16} /> Edit
                </button>
              )}
            </div>
            
            {editingIndex === index ? (
              <div className="flex flex-col gap-3">
                <textarea
                  className="input-field min-h-[200px] font-mono text-sm"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                />
                <div>
                  <label className="input-label text-blue-400">Why are you changing this? (Optional: used to teach the Swarm)</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g., 'Make it more formal', 'Don't use lists here'"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button className="btn btn-outline" onClick={() => setEditingIndex(null)}>
                    <X size={16} /> Cancel
                  </button>
                  <button className="btn bg-green-600 hover:bg-green-700 text-white" onClick={() => handleSaveEdit(index)}>
                    <Check size={16} /> Save & Learn
                  </button>
                </div>
              </div>
            ) : (
              <div className="prose prose-invert max-w-none text-sm text-[var(--color-text-muted)] max-h-48 overflow-y-auto whitespace-pre-wrap custom-scrollbar">
                {section.content}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
