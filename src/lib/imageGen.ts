export async function fetchAiImage(prompt: string, timeoutMs: number = 15000): Promise<string | null> {
  const encodedPrompt = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=600&nologo=true`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      console.warn(`Failed to fetch AI image. Status: ${response.status}`);
      return null;
    }

    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => {
        console.warn('Failed to convert Blob to Base64');
        resolve(null);
      };
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`Image generation timed out after ${timeoutMs}ms for prompt: ${prompt}`);
    } else {
      console.warn('Network error or other failure fetching AI image:', error);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
