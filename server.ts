import express from "express";
import http from "http";
import { createServer as createViteServer } from "vite";
import path from "path";
import puppeteer from "puppeteer";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const SYSTEM_INSTRUCTION = `You are OmniPilot, an intelligent UI Navigator and Workflow Automator. Your core function is to interpret visual user interfaces (screenshots) and natural language commands to generate precise, executable UI actions. You operate as the user's hands on screen, automating tasks across web browsers and applications.

**Your Responsibilities:**
1.  **Visual Interpretation**: Analyze provided screenshots to understand the current state of the UI. Identify interactive elements (buttons, input fields, links, icons, text labels) and their context.
2.  **Intent Understanding**: Accurately infer the user's goal from their natural language command, considering the visual context of the screenshot.
3.  **Action Generation**: Translate the user's intent into a COMPLETE sequence of atomic, executable UI actions. You MUST generate ALL steps required to fulfill the user's entire command, even if subsequent UI elements are not yet visible in the initial screenshot. Make reasonable assumptions for the target values (e.g., text labels) of those subsequent steps based on the user's prompt.
4.  **Spatial Grounding**: For actions interacting with visible elements, provide exact spatial coordinates [y, x] on a 1000x1000 grid. For elements you assume will appear in subsequent steps, you may omit coordinates or provide a best guess, but you MUST still generate the action.
5.  **Form Submission**: If you are typing into a search bar or form, you MUST submit it. Do this by either clicking the search icon/button, or using the 'press' action with the 'Enter' key.
6.  **Reasoning**: Provide a brief explanation of why you chose this action.

**Executable Action Schema (JSON):**

Each action object in the array should have the following structure:

\`\`\`json
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
- keyboard: Target the keyboard (e.g., for pressing keys).

Constraints:
- CRITICAL: You MUST output the FULL sequence of actions requested by the user. Do not stop after the first step. Think step-by-step through the entire workflow.
- If a target element is not visible in the current screenshot but is required for a subsequent step, use the 'text' or 'placeholder' target type with the expected value based on the user's command. OMIT the 'coordinates' field for these steps.
- If searching, remember to submit the search (press Enter or click the search button).
- If navigating to a new page or submitting a form, add a 'wait' action afterwards to allow the page to load before interacting with new elements.
- Always generate the most logical and efficient sequence of actions.`;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/screenshot", async (req, res) => {
    let browser;
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: "Missing url" });
      }

      console.log(`Fetching screenshot for ${url}`);
      
      browser = await puppeteer.launch({
        headless: true,
        pipe: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      const screenshot = await page.screenshot({ encoding: 'base64' });
      
      res.json({ 
        success: true, 
        screenshot: `data:image/png;base64,${screenshot}`
      });
      
    } catch (error: any) {
      console.error("Screenshot error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch screenshot" });
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  });

  let activeBrowser: any = null;
  let activePage: any = null;

  app.post("/api/execute-puppeteer", async (req, res) => {
    let browser;
    let isExecuting = false;
    
    // Close existing browser if any
    if (activeBrowser) {
      try { await activeBrowser.close(); } catch (e) {}
      activeBrowser = null;
      activePage = null;
    }
    
    try {
      const { url, actions } = req.body;
      
      if (!url || !actions || !Array.isArray(actions)) {
        return res.status(400).json({ error: "Missing url or actions array" });
      }

      console.log(`Starting Puppeteer execution on ${url}`);
      
      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
      res.flushHeaders();
      
      const sendEvent = (event: string, data: any) => {
        res.write(`data: ${JSON.stringify({ event, data })}\n\n`);
        // Flush the response if the method exists (e.g., when using compression)
        if (typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
      };

      sendEvent('log', 'Launching browser...');

      browser = await puppeteer.launch({
        headless: true,
        pipe: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      
      activeBrowser = browser;
      
      const page = await browser.newPage();
      activePage = page;
      await page.setViewport({ width: 1280, height: 800 });
      
      // Add detailed page logging for debugging
      page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
      page.on('pageerror', error => {
        console.error(`[Browser Page Error]: ${error.message}`);
        sendEvent('log', `Browser Error: ${error.message}`);
      });
      page.on('requestfailed', request => {
        console.error(`[Browser Request Failed]: ${request.url()} - ${request.failure()?.errorText}`);
      });
      
      isExecuting = true;
      
      // Live stream loop
      const streamScreenshots = async () => {
        while (!page.isClosed()) {
          try {
            const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 60 });
            sendEvent('screenshot', `data:image/jpeg;base64,${screenshot}`);
          } catch (e) {
            // Ignore errors during screenshot capture (e.g., page navigating)
          }
          await new Promise(r => setTimeout(r, 500)); // 2 FPS
        }
      };
      
      // Start streaming in the background
      streamScreenshots();

      sendEvent('log', `Navigating to ${url}...`);
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      for (const action of actions) {
        sendEvent('log', `Executing: ${action.action} on ${action.target.value}`);
        
        // Wait before every action to ensure page is ready and animations have settled
        await new Promise(r => setTimeout(r, 2000));
        
        if (action.action === 'navigate') {
          await page.goto(action.target.value, { waitUntil: 'networkidle2' });
        } else if (action.action === 'wait') {
          await new Promise(r => setTimeout(r, 2000));
        } else if (action.action === 'press') {
          // @ts-ignore
          await page.keyboard.press(action.value || action.target.value || 'Enter');
          await new Promise(r => setTimeout(r, 1000));
        } else if (action.coordinates && action.coordinates.length === 2) {
          // Convert 1000x1000 grid coordinates to actual viewport coordinates
          const [y, x] = action.coordinates;
          const actualX = (x / 1000) * 1280;
          const actualY = (y / 1000) * 800;
          
          if (action.action === 'click') {
            await page.mouse.click(actualX, actualY);
            await new Promise(r => setTimeout(r, 1000)); // Wait for click effect
          } else if (action.action === 'type' && action.value) {
            await page.mouse.click(actualX, actualY);
            await page.keyboard.type(action.value);
            await new Promise(r => setTimeout(r, 500));
          } else if (action.action === 'hover') {
            await page.mouse.move(actualX, actualY);
            await new Promise(r => setTimeout(r, 500));
          }
        } else {
          // Fallback if coordinates are missing (e.g., for subsequent steps)
          let elementHandle = null;
          
          if (action.target.type === 'placeholder') {
            try {
              elementHandle = await page.waitForSelector(`[placeholder*="${action.target.value}" i]`, { timeout: 5000 });
            } catch (e) {}
          }
          
          if (!elementHandle) {
            const textSelectors = [
              `::-p-text(${action.target.value})`,
              `[aria-label*="${action.target.value}" i]`,
              `[title*="${action.target.value}" i]`,
              `a[href*="${action.target.value.toLowerCase().replace(/ /g, '_')}"]`
            ];
            
            for (const sel of textSelectors) {
              try {
                elementHandle = await page.waitForSelector(sel, { timeout: 3000 });
                if (elementHandle) break;
              } catch (e) {}
            }
          }
          
          if (!elementHandle) {
            throw new Error(`No element found for target: ${action.target.value}`);
          }
          
          if (action.action === 'click') {
            await elementHandle.click();
            await new Promise(r => setTimeout(r, 1000));
          } else if (action.action === 'type' && action.value) {
            await elementHandle.click();
            await page.keyboard.type(action.value);
            await new Promise(r => setTimeout(r, 500));
          } else if (action.action === 'hover') {
            await elementHandle.hover();
            await new Promise(r => setTimeout(r, 500));
          }
        }
        
        // Add a small delay so the user can see the progress
        await new Promise(r => setTimeout(r, 1000));
      }
      
      isExecuting = false;
      sendEvent('log', 'Execution completed successfully. Interactive mode active.');
      sendEvent('interactive', { active: true });
      
      // Keep the connection open until the browser is closed
      await new Promise(resolve => {
        browser.on('disconnected', resolve);
      });
      
    } catch (error: any) {
      console.error("Puppeteer execution error details:", error);
      if (error.stack) {
        console.error("Stack trace:", error.stack);
      }
      
      try {
        if (browser) {
          const pages = await browser.pages();
          if (pages.length > 0 && !pages[0].isClosed()) {
            const errorScreenshot = await pages[0].screenshot({ encoding: 'base64', type: 'jpeg', quality: 60 });
            res.write(`data: ${JSON.stringify({ event: 'screenshot', data: `data:image/jpeg;base64,${errorScreenshot}` })}\n\n`);
          }
        }
      } catch (screenshotError) {
        console.error("Could not take error screenshot:", screenshotError);
      }

      res.write(`data: ${JSON.stringify({ event: 'error', data: error.message || "Failed to execute actions" })}\n\n`);
    } finally {
      isExecuting = false;
      // Do NOT close the browser here, keep it open for interactive mode
      res.end();
    }
  });

  app.post("/api/puppeteer/interact", async (req, res) => {
    if (!activePage || activePage.isClosed()) {
      return res.status(400).json({ error: "No active session" });
    }
    
    const { action, x, y, text, deltaY } = req.body;
    try {
      if (action === 'click') {
        await activePage.mouse.click(x, y);
      } else if (action === 'type') {
        await activePage.keyboard.type(text);
      } else if (action === 'scroll') {
        await activePage.mouse.wheel({ deltaY: deltaY || 500 });
      } else if (action === 'press') {
        await activePage.keyboard.press(text || 'Enter');
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/puppeteer/close", async (req, res) => {
    if (activeBrowser) {
      try { await activeBrowser.close(); } catch (e) {}
      activeBrowser = null;
      activePage = null;
    }
    res.json({ success: true });
  });

  const server = http.createServer(app);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is in use, retrying...`);
      setTimeout(() => {
        server.close();
        server.listen(PORT, "0.0.0.0");
      }, 1000);
    } else {
      console.error("Server error:", e);
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
