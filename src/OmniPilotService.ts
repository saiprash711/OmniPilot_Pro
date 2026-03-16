import { GoogleGenAI, Type } from "@google/genai";

const SYSTEM_INSTRUCTION = `You are OmniPilot, an intelligent UI Navigator and Workflow Automator. Your core function is to interpret visual user interfaces (screenshots) and natural language commands to generate precise, executable UI actions. You operate as the user's hands on screen, automating tasks across web browsers and applications.

**Your Responsibilities:**
1.  **Visual Interpretation**: Analyze provided screenshots to understand the current state of the UI. Identify interactive elements (buttons, input fields, links, icons, text labels) and their context.
2.  **Intent Understanding**: Accurately infer the user's goal from their natural language command. Pay close attention to multi-step instructions.
3.  **Action Generation**: Translate the user's intent into a COMPLETE sequence of atomic, executable UI actions. You MUST generate ALL steps required to fulfill the user's entire command, even if subsequent UI elements are not yet visible in the initial screenshot. Make reasonable assumptions for the target values (e.g., text labels) of those subsequent steps based on the user's prompt.
4.  **Spatial Grounding**: For actions interacting with visible elements, provide exact spatial coordinates [y, x] on a 1000x1000 grid. For elements you assume will appear in subsequent steps, you may omit coordinates or provide a best guess, but you MUST still generate the action.
5.  **Form Submission**: If you are typing into a search bar or form, you MUST submit it. Do this by either clicking the search icon/button, or using the 'press' action with the 'Enter' key.
6.  **Reasoning**: Provide a brief explanation of why you chose this action.

**Executable Action Schema (JSON):**

You must return a JSON object with the following structure:

\`\`\`json
{
  "extractedUrl": "https://...", // The URL visible in the browser address bar in the screenshot, if any. Return null if no URL is visible.
  "actions": [
    {
      "action": "<action_type>",
      "target": {
        "type": "<target_type>",
        "value": "<target_value>"
      },
      "value": "<input_value>", // Optional: for 'type' or 'press' action
      "coordinates": [y, x], // Required for click, type, hover if visible. Scaled to 1000x1000 grid.
      "reasoning": "Brief explanation of why this action and location were chosen"
    }
  ]
}
\`\`\`

action_type can be one of:
- click: Simulate a mouse click.
- type: Simulate keyboard input into a text field.
- hover: Move the mouse over an element.
- press: Press a specific keyboard key (e.g., "Enter", "Escape").
- scroll: Scroll the page/element.
- navigate: Go to a specific URL.
- wait: Pause for a specified duration.

target_type can be one of:
- text: Target an element by its visible text label (e.g., "Sign In", "Submit").
- icon: Target an element by describing its icon (e.g., "magnifying glass icon", "gear icon").
- label: Target an input field by its associated label (e.g., "Username", "Search").
- placeholder: Target an input field by its placeholder text.
- coordinates: Target an element by approximate screen coordinates.
- window: Target the entire browser window (e.g., for scrolling).
- keyboard: Target the keyboard (e.g., for pressing Enter).

Constraints:
- CRITICAL: You MUST output the FULL sequence of actions requested by the user. Do not stop after the first step. Think step-by-step through the entire workflow, from start to finish. If the user asks to extract data, you must navigate to the data, select the filters, and click the export/download button.
- CRITICAL: If the user's request involves multiple steps (e.g., "select X, then extract Y, then export"), you MUST generate an array with MULTIPLE action objects.
- If a target element is not visible in the current screenshot but is required for a subsequent step, use the 'text' or 'placeholder' target type with the expected value based on the user's command. OMIT the 'coordinates' field for these steps.
- If searching, remember to submit the search (press Enter or click the search button).
- If navigating to a new page or submitting a form, add a 'wait' action afterwards to allow the page to load before interacting with new elements.
- Always generate the most logical and efficient sequence of actions.`;

export interface Action {
  action: 'click' | 'type' | 'scroll' | 'navigate' | 'wait' | 'hover' | 'press';
  target: {
    type: 'text' | 'icon' | 'label' | 'placeholder' | 'coordinates' | 'window' | 'keyboard';
    value: string;
  };
  value?: string;
  coordinates?: [number, number];
  reasoning?: string;
}

export interface GenerationResult {
  extractedUrl: string | null;
  actions: Action[];
}

export async function generateActions(base64Image: string, mimeType: string, command: string): Promise<GenerationResult> {
  try {
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || '';
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType,
            },
          },
          {
            text: command,
          },
        ],
      },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            extractedUrl: {
              type: Type.STRING,
              description: "The URL visible in the browser address bar in the screenshot, if any. Null if not visible.",
              nullable: true,
            },
            actions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  action: {
                    type: Type.STRING,
                    description: "The type of action to perform (click, type, scroll, navigate, wait, press).",
                  },
                  target: {
                    type: Type.OBJECT,
                    properties: {
                      type: {
                        type: Type.STRING,
                        description: "The type of target (text, icon, label, placeholder, coordinates, window, keyboard).",
                      },
                      value: {
                        type: Type.STRING,
                        description: "The value identifying the target.",
                      },
                    },
                    required: ["type", "value"],
                  },
                  value: {
                    type: Type.STRING,
                    description: "The value to type, if the action is 'type'.",
                  },
                  coordinates: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.NUMBER,
                    },
                    description: "The [y, x] coordinates of the target element on a 1000x1000 grid.",
                  },
                  reasoning: {
                    type: Type.STRING,
                    description: "Brief explanation of why this action and location were chosen.",
                  },
                },
                required: ["action", "target"],
              },
            },
          },
          required: ["actions"],
        },
      },
    });

    const text = response.text;
    if (!text) return { extractedUrl: null, actions: [] };
    
    return JSON.parse(text) as GenerationResult;
  } catch (error) {
    console.error("Error generating actions:", error);
    throw error;
  }
}

export async function extractUrlFromImage(base64Image: string, mimeType: string): Promise<string | null> {
  try {
    // Use the Vite-replaced process.env.GEMINI_API_KEY or the platform-injected process.env.API_KEY
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || '';
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType,
            },
          },
          {
            text: "Read the URL visible in the browser address bar in the provided image. Return ONLY the raw URL string (e.g., 'https://www.example.com'). Do NOT return JSON. Do NOT return bounding boxes. If no URL is visible, return the exact string 'NONE'.",
          },
        ],
      },
    });

    let text = response.text?.trim() || '';
    
    // Remove any markdown formatting if present
    text = text.replace(/^```[a-z]*\n/, '').replace(/\n```$/, '').trim();
    
    // Handle cases where the model returns JSON or "NONE"
    if (text === 'NONE' || text.includes('box_2d') || text.startsWith('{') || text === '') {
      return null;
    }
    
    // Basic URL validation
    if (!text.includes('.')) {
      return null;
    }
    
    if (!text.startsWith('http://') && !text.startsWith('https://')) {
      text = 'https://' + text;
    }
    return text;
  } catch (error) {
    console.error("Error extracting URL:", error);
    return null;
  }
}

export async function executeWithPuppeteer(
  url: string, 
  actions: Action[],
  onLog: (log: string) => void,
  onScreenshot: (screenshot: string) => void,
  onInteractive?: () => void
): Promise<void> {
  try {
    const response = await fetch('/api/execute-puppeteer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        actions
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to execute actions in Puppeteer');
    }

    if (!response.body) {
      throw new Error("No response body from server");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          let data;
          try {
            data = JSON.parse(line.slice(6));
          } catch (e) {
            // Ignore parsing errors for incomplete chunks
            continue;
          }
          
          if (data.event === 'log') {
            onLog(data.data);
          } else if (data.event === 'screenshot') {
            onScreenshot(data.data);
          } else if (data.event === 'error') {
            throw new Error(data.data);
          } else if (data.event === 'interactive') {
            if (onInteractive) onInteractive();
          } else if (data.event === 'done') {
            return;
          }
        }
      }
    }
  } catch (error) {
    console.error("Error executing with Puppeteer:", error);
    throw error;
  }
}
