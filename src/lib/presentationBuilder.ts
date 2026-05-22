import pptxgen from 'pptxgenjs';
import { fetchAiImage } from './imageGen';

export async function buildPresentation(compiledText: string, projectName: string): Promise<Blob> {
  const pptx = new pptxgen();
  pptx.title = projectName || "Presentation";
  pptx.layout = "LAYOUT_16x9";

  const slides = compiledText.split('\n---\n').filter(s => s.trim());

  for (const slideText of slides) {
    // Parse Title
    let title = '';
    const titleMatch = slideText.match(/Slide \d+:\s*(.*)/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
    } else {
      const altTitleMatch = slideText.match(/-\s*Title:\s*(.*)/i);
      if (altTitleMatch) {
        title = altTitleMatch[1].trim();
      }
    }

    // Parse Chart
    let chartType: pptxgen.CHART_NAME | null = null;
    let chartData: any[] = [];
    let hasChart = false;

    const chartRegex = /\[NATIVE_CHART:\s*(.*?),\s*({[\s\S]*?})\]/i;
    const chartMatch = slideText.match(chartRegex);
    if (chartMatch) {
      hasChart = true;
      const typeString = chartMatch[1].trim().toLowerCase();
      const jsonString = chartMatch[2].trim();
      
      try {
        const parsedJson = JSON.parse(jsonString);
        if (typeString === 'bar' || typeString === 'column') {
           chartType = pptx.ChartType.bar;
        } else if (typeString === 'pie') {
           chartType = pptx.ChartType.pie;
        } else if (typeString === 'line') {
           chartType = pptx.ChartType.line;
        } else {
           chartType = pptx.ChartType.bar; 
        }
        
        if (parsedJson.labels && parsedJson.datasets) {
          chartData = [
            {
              name: "Series 1",
              labels: parsedJson.labels,
              values: parsedJson.datasets
            }
          ];
        }
      } catch (e) {
        console.warn('Failed to parse chart JSON:', e);
        hasChart = false;
      }
    }

    // Parse Visual Prompt
    const visualPromptMatch = slideText.match(/\[VISUAL_PROMPT:\s*(.*?)\]/i);
    let visualPrompt = '';
    if (visualPromptMatch) {
      visualPrompt = visualPromptMatch[1].trim();
    }

    // Parse Speaker Notes
    const speakerNotesMatch = slideText.match(/\[SPEAKER_NOTES:\s*([\s\S]*?)\](?=\n\[|$)/i);
    let speakerNotes = '';
    if (speakerNotesMatch) {
      speakerNotes = speakerNotesMatch[1].trim();
    }

    // Clean up text content for bullets
    const cleanLines = slideText.split('\n').filter(line => {
      if (line.match(/Slide \d+:/i)) return false;
      if (line.match(/\[THEME/i)) return false;
      if (line.match(/\[LAYOUT/i)) return false;
      if (line.match(/\[CONTENT\]/i)) return false;
      if (line.match(/\[NATIVE_CHART/i)) return false;
      if (line.match(/\[VISUAL_PROMPT/i)) return false;
      if (line.match(/\[SPEAKER_NOTES/i)) return false;
      if (line.match(/-\s*Title:/i)) return false; 
      if (line.trim() === '---') return false;
      if (line.trim().startsWith('```')) return false; // filter code fences
      return line.trim() !== '';
    });

    const bulletPoints = cleanLines
      .map(line => {
        let cleaned = line.replace(/^-+\s*/, '').trim();
        // Aggressive markdown sanitization
        cleaned = cleaned.replace(/(\*\*|__)(.*?)\1/g, '$2'); // Bold
        cleaned = cleaned.replace(/(\*|_)(.*?)\1/g, '$2'); // Italic
        cleaned = cleaned.replace(/`([^`]+)`/g, '$1'); // Inline code
        cleaned = cleaned.replace(/^#+\s+/, ''); // Headers
        // Remove rogue labels
        cleaned = cleaned.replace(/^(Title|Subtitle|Content|Bullet points|Bullets):\s*/i, '');
        return cleaned.trim();
      })
      .filter(line => line.length > 0)
      .join('\n');

    // Quality Gate: Skip empty/incomplete slides
    if (!title && bulletPoints.length === 0 && !hasChart && !visualPrompt) {
      console.warn('Skipping empty slide detected in generation.');
      continue;
    }

    // ADD SLIDE NOW (since it passed quality gates)
    const slide = pptx.addSlide();
    
    // Parse Theme
    const themeMatch = slideText.match(/\[THEME:\s*(.*?)\]/i);
    let themeColor = 'FFFFFF';
    let textColor = '333333';
    
    if (themeMatch) {
      const themeVal = themeMatch[1].trim().toUpperCase();
      if (themeVal === 'ENTERPRISE_DARK') {
        themeColor = '0F172A';
        textColor = 'FFFFFF';
      }
    }
    
    slide.background = { color: themeColor };

    if (speakerNotes) {
      slide.addNotes(speakerNotes);
    }

    // Default text formatting
    const textOptions: pptxgen.TextPropsOptions = {
      x: 0.5,
      y: 1.5,
      w: '45%',
      h: 4.5,
      fontSize: 18,
      color: textColor,
      valign: 'top',
      bullet: true,
    };

    if (title) {
      slide.addText(title, {
        x: 0.5,
        y: 0.5,
        w: '90%',
        h: 0.8,
        fontSize: 32,
        bold: true,
        color: textColor,
      });
    }

    // Add Image or Chart to Right Column
    if (hasChart && chartData.length > 0 && chartType) {
      slide.addChart(chartType, chartData, {
        x: 5.5,
        y: 1.5,
        w: 4.0,
        h: 3.5,
        showLegend: true,
        chartColors: ['3B82F6', '10B981', 'F59E0B', 'EF4444', '8B5CF6'],
        showTitle: false,
      });
    } else if (visualPrompt) {
      const base64Image = await fetchAiImage(visualPrompt);
      if (base64Image) {
        slide.addImage({
          data: base64Image,
          x: 5.5,
          y: 1.5,
          w: 4.0,
          h: 3.5,
          sizing: { type: 'contain', w: 4.0, h: 3.5 }
        });
      }
    } else {
      // If no chart and no image, make text full width
      textOptions.w = '90%';
    }

    if (bulletPoints) {
      slide.addText(bulletPoints, textOptions);
    }
  }

  return (await pptx.write({ outputType: 'blob' })) as Blob;
}
