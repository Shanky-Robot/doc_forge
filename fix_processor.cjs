const fs = require('fs');

let content = fs.readFileSync('src/lib/processor.ts', 'utf8');

const target = "10. DO NOT summarize aggressively. Expand on all points exhaustively. Utilize all available template fields. Ensure the final output is highly detailed and comprehensive.`;";
const replacement = "10. DO NOT summarize aggressively. Expand on all points exhaustively. Utilize all available template fields. Ensure the final output is highly detailed and comprehensive.\n11. CRITICAL CONSTRAINT: You must output ONLY the final, client-ready content for this section. DO NOT echo back the section title, DO NOT output 'SECTION DEFINITION', 'GLOBAL CONTEXT', or any internal instructions. Start directly with the professional content.`;";

content = content.replace(target, replacement);

fs.writeFileSync('src/lib/processor.ts', content);
console.log("Replaced phase 1");
