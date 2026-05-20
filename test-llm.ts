import { checkConnection, generateCompletion } from './src/lib/llm';

async function main() {
  const config = {
    localUrl: "http://192.168.29.106:1234",
  };

  console.log("Checking connection...");
  const isConnected = await checkConnection(config);
  console.log("Is connected:", isConnected);

  console.log("Generating completion...");
  try {
    const response = await generateCompletion(config, [{ role: 'user', content: 'Hello' }]);
    console.log("Response:", response);
  } catch (error) {
    console.error("Error generating completion:", error);
  }
}

main();
