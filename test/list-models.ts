// This script uses standard fetch API to query the models list

async function listModels() {
    try {
        // Try to list models using the correct SDK method
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data: any = await response.json();
        if (data.models) {
            for (const m of data.models) {
                console.log(`${m.name}: ${m.supportedGenerationMethods}`);
            }
        } else {
            console.log("No models found or error:", JSON.stringify(data));
        }
    } catch (err) {
        console.error("Error listing models:", err);
    }
}

listModels();
