import { z } from 'zod';
import { llmClient } from '../llm/llmClient.js';
import { requirementSchema } from '../validation/kitSchemas.js';
import { logger } from '../../utils/logger.js';

const stage1Schema = z.object({
  role_title: z.string().optional().default(''),
  seniority: z.string().optional().default(''),
  responsibilities: z.array(z.string()).optional().default([]),
  requirements: z.array(requirementSchema)
});

export function cleanRequirementText(text) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text
    .replace(/^[-*•\d.]+\s*/, '')
    .replace(/\b(must\s+have|at\s+least|minimum|required|seeking)?\s*\d+[\d\s\-–+]*\s*(years?|yrs?)\s*(of\s*)?(experience\s*(in|with|of)?|exp\.?\s*(in|with)?|working\s*with)?\s*/gi, '')
    .replace(/\bexperience\s+(in|with|of)\s+/gi, '')
    .replace(/\bstrong\s+knowledge\s+of\s+/gi, '')
    .replace(/\bproficient\s+(in|with)\s+/gi, '')
    .replace(/\bdemonstrated\s+ability\s+to\s+/gi, '')
    .replace(/\bproven\s+track\s+record\s+in\s+/gi, '')
    .trim();

  if (cleaned.length < 3) {
    cleaned = text.replace(/^[-*•\d.]+\s*/, '').trim();
  }

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export async function extractRequirements(jdText) {
  if (!jdText || typeof jdText !== 'string' || jdText.trim().length === 0) {
    return {
      role_title: 'Software Engineer',
      seniority: 'Mid-Senior',
      responsibilities: [],
      requirements: []
    };
  }

  const prompt = `Extract job requirements, role title, seniority, and responsibilities from the following Job Description (JD).

Job Description:
"""
${jdText.slice(0, 15000)}
"""

CRITICAL INSTRUCTIONS:
1. Extract the EXACT Role Title (e.g. "Full Stack MERN Developer", "Senior Frontend Engineer", "DevOps Specialist", "Node.js Backend Engineer") mentioned in the JD.
2. Extract Seniority (e.g. "Fresher / Entry-Level", "Junior", "Mid-Level", "Senior", "Lead").
3. Return JSON matching:
{
  "role_title": "Full Stack MERN Developer",
  "seniority": "Fresher / Entry-Level",
  "responsibilities": ["Build React components", "Optimize Node.js APIs"],
  "requirements": [
    {
      "id": "r1",
      "text": "React and Node.js backend development",
      "kind": "technical",
      "priority": "must"
    }
  ]
}
4. Clean requirement text to capture the core technical skill, behavioral competency, or domain concept without prefixing experience durations (e.g. use "React & Node.js architecture" instead of "3+ years of experience in React").
5. "kind" must strictly be one of: "technical", "behavioural", "domain".
6. "priority" must strictly be one of: "must", "nice".
7. Do NOT fabricate requirements or responsibilities not mentioned in the JD. If the JD is concise or thin (e.g. only 2 lines), extract strictly what is present without inventing unstated technologies, experience durations, or tools.`;

  const systemInstruction = 'You are a technical hiring manager extracting structured requirements, role title, and seniority from job descriptions.';

  const isThinJd = jdText.trim().length < 200 || jdText.trim().split(/\r?\n/).filter(l => l.trim().length > 3).length <= 3;
  const jdQualityNote = isThinJd
    ? `Job description is very short (${jdText.trim().length} characters, ${jdText.trim().split(/\r?\n/).filter(l => l.trim().length > 3).length} meaningful lines). Only the requirements explicitly stated could be extracted — the kit reflects this limited input and does not invent unstated skills.`
    : '';

  try {
    const llmResult = await llmClient.generateJSON({
      prompt,
      systemInstruction,
      schemaValidator: stage1Schema
    });

    if (llmResult && llmResult.requirements && llmResult.requirements.length > 0) {
      if (!llmResult.role_title || llmResult.role_title === 'Unspecified Role') {
        const fallbackInfo = fallbackRequirementExtractor(jdText);
        llmResult.role_title = fallbackInfo.role_title;
        if (!llmResult.seniority) llmResult.seniority = fallbackInfo.seniority;
      }
      llmResult.requirements = llmResult.requirements.map(req => ({
        ...req,
        text: cleanRequirementText(req.text)
      }));
      llmResult.is_thin_jd = isThinJd;
      llmResult.jd_quality_note = jdQualityNote;
      return llmResult;
    }
  } catch (err) {
    logger.warn(`[Stage 1] Requirement extraction LLM error: ${err.message}`);
  }

  logger.info('[Stage 1] Using heuristic requirement extraction fallback.');
  const fallbackResult = fallbackRequirementExtractor(jdText);
  fallbackResult.is_thin_jd = isThinJd;
  fallbackResult.jd_quality_note = jdQualityNote;
  return fallbackResult;
}

function fallbackRequirementExtractor(jdText) {
  const lines = jdText
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•\d.]+\s*/, '').trim())
    .filter((l) => l.length > 5);

  let role_title = '';
  let seniority = 'Mid-Level';

  if (/fresher|junior|intern|entry/i.test(jdText)) seniority = 'Fresher / Entry-Level';
  else if (/senior|lead|principal|staff/i.test(jdText)) seniority = 'Senior';

  for (const line of lines.slice(0, 10)) {
    const l = line.toLowerCase();
    if (l.includes('developer') || l.includes('engineer') || l.includes('architect') || l.includes('specialist') || l.includes('lead')) {
      if (line.length < 80) {
        role_title = line;
        break;
      }
    }
  }

  if (!role_title) {
    if (/mern|mean|full stack|fullstack/i.test(jdText)) role_title = 'Full Stack MERN Developer';
    else if (/frontend|react|vue|angular/i.test(jdText)) role_title = 'Frontend React Engineer';
    else if (/backend|node|express|python|java/i.test(jdText)) role_title = 'Backend Engineer';
    else if (/devops|cloud|aws/i.test(jdText)) role_title = 'DevOps Engineer';
    else role_title = 'Software Engineer';
  }

  const requirements = [];
  const responsibilities = [];
  let reqCount = 1;

  lines.forEach((line) => {
    const lower = line.toLowerCase();
    if (
      lower.includes('build') ||
      lower.includes('develop') ||
      lower.includes('design') ||
      lower.includes('collaborate') ||
      lower.includes('maintain') ||
      lower.includes('lead')
    ) {
      if (responsibilities.length < 5) responsibilities.push(line);
    }

    if (
      lower.includes('experience') ||
      lower.includes('years') ||
      lower.includes('knowledge') ||
      lower.includes('proficient') ||
      lower.includes('familiar') ||
      lower.includes('ability') ||
      lower.includes('degree') ||
      lower.includes('react') ||
      lower.includes('node') ||
      lower.includes('sql') ||
      lower.includes('python') ||
      lower.includes('aws') ||
      lower.includes('communication')
    ) {
      let kind = 'technical';
      if (
        lower.includes('communication') ||
        lower.includes('leadership') ||
        lower.includes('team') ||
        lower.includes('collaboration') ||
        lower.includes('mindset')
      ) {
        kind = 'behavioural';
      } else if (
        lower.includes('fintech') ||
        lower.includes('healthcare') ||
        lower.includes('domain') ||
        lower.includes('e-commerce') ||
        lower.includes('saas')
      ) {
        kind = 'domain';
      }

      let priority = 'must';
      if (lower.includes('nice to have') || lower.includes('plus') || lower.includes('preferred') || lower.includes('optional')) {
        priority = 'nice';
      }

      requirements.push({
        id: `r${reqCount++}`,
        text: cleanRequirementText(line.slice(0, 150)),
        kind,
        priority
      });
    }
  });

  if (requirements.length === 0) {
    requirements.push({
      id: 'r1',
      text: 'General software development & problem solving skills',
      kind: 'technical',
      priority: 'must'
    });
  }

  return {
    role_title,
    seniority,
    responsibilities: responsibilities.length > 0 ? responsibilities : ['Develop software solutions', 'Collaborate with team'],
    requirements: requirements.slice(0, 15)
  };
}
