import { extractAbstractFromText } from "../services/abstractExtractionService.ts";

const text = `Abstrak\nAng pag-aaral na ito ay sumusuri sa mga resulta ng pananaliksik at naglalahad ng pamamaraan. Ipinapakita ng mga natuklasan ang malinaw na pagbabago sa mga sinusukat na kinalabasan. Nagbibigay ito ng batayan para sa susunod na pagpaplano.\nMga Susing Salita\nresilience`;
const result = extractAbstractFromText(text, "ocr");
if (!result.candidate || result.candidate.method !== "ocr" || result.candidate.pageStart !== 1) throw new Error("Filipino abstract fixture did not produce an OCR candidate.");
console.log(JSON.stringify({ ok: true, method: result.candidate.method, pageStart: result.candidate.pageStart, confidence: result.candidate.confidence }, null, 2));
