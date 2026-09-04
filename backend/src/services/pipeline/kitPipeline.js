import { extractRequirements } from './stage1_requirements.js';
import { researchCompany } from '../webResearch/companyResearchService.js';
import { researchPublicInterviewProcess } from '../webResearch/publicInterviewResearchService.js';
import { generateInitialQuestions } from './stage4_questionGeneration.js';
import { runSecondPassGeneration } from './stage6_secondPass.js';
import { allocateSchedule } from '../schedule/scheduleAllocator.js';
import { generateFlashcards } from './stage8_flashcards.js';
import { kitSchema } from '../validation/kitSchemas.js';
import { logger } from '../../utils/logger.js';

export async function runKitPipeline({ jd, companyUrl, days = 5, onProgress = () => {} }) {
  const daysAvailable = Math.max(1, Math.min(60, Number(days) || 5));

  // Step 1: Requirement Extraction
  await onProgress('ANALYZING_JD', 'Analyzing job description...');
  const stage1Result = await extractRequirements(jd);
  const requirements = stage1Result.requirements || [];

  // Step 2: Company Crawl & Research
  await onProgress('RESEARCHING_COMPANY', 'Researching company...');
  await onProgress('DISCOVERING_PAGES', 'Discovering relevant pages...');
  const companyBriefResult = await researchCompany(companyUrl);

  // Step 3: Public Interview Process Research
  await onProgress('SEARCHING_DISCUSSIONS', 'Searching interview discussions...');
  const interviewResearchResult = await researchPublicInterviewProcess(
    companyUrl,
    companyBriefResult.what_they_do || companyBriefResult.summary
  );

  // Step 4: Initial Question Generation (Pass stage1Result for roleTitle & seniority context)
  await onProgress('GENERATING_QUESTIONS', 'Generating questions...');
  const initialQuestions = await generateInitialQuestions(
    requirements,
    companyBriefResult,
    stage1Result,
    { isThinJd: stage1Result.is_thin_jd, companyResearchAvailable: companyBriefResult.company_research_available }
  );

  // Step 5 & 6: Coverage Check & Second Pass Generation
  await onProgress('CHECKING_COVERAGE', 'Checking requirement coverage...');
  const secondPassResult = await runSecondPassGeneration(requirements, initialQuestions, companyBriefResult);

  if (secondPassResult.coverage.uncovered_requirement_ids.length > 0) {
    await onProgress('GENERATING_MISSING', 'Generating missing questions for coverage...');
  }

  // Step 7: Deterministic Schedule Allocation
  await onProgress('BUILDING_SCHEDULE', 'Building study schedule...');
  const scheduleResult = allocateSchedule(secondPassResult.questions, requirements, daysAvailable);

  // Step 8: Flashcard Generation
  await onProgress('GENERATING_FLASHCARDS', 'Generating flashcards...');
  const flashcards = await generateFlashcards(requirements, secondPassResult.questions, { isThinJd: stage1Result.is_thin_jd });

  // Step 9: Final Kit Schema Assembly & Validation
  await onProgress('VALIDATING_KIT', 'Validating final kit...');

  // Dynamically extract Company Name from URL domain or brief summary
  let companyName = 'Target Company';
  if (companyUrl && typeof companyUrl === 'string' && companyUrl.trim().length > 0) {
    try {
      const parsedUrl = new URL(companyUrl.startsWith('http') ? companyUrl : `https://${companyUrl}`);
      const hostname = parsedUrl.hostname.replace(/^www\./i, '');
      const parts = hostname.split('.');
      if (parts[0] && parts[0].length > 1) {
        const rawDomain = parts[0];
        companyName = rawDomain.charAt(0).toUpperCase() + rawDomain.slice(1);
      }
    } catch (e) {
      // Fallback
    }
  }

  if (companyName === 'Target Company' && companyBriefResult?.summary) {
    const cleaned = companyBriefResult.summary.replace(/^(Basic|The|Overview|Company|Information|Public)\s+/i, '');
    const firstWord = cleaned.split(/\s+/)[0]?.replace(/[^a-zA-Z0-9]/g, '');
    if (firstWord && firstWord.length > 2 && firstWord.toLowerCase() !== 'basic') {
      companyName = firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
    }
  }

  const roleTitle = stage1Result.role_title && stage1Result.role_title !== 'Unspecified Role'
    ? stage1Result.role_title
    : 'Software Engineer';

  const usedPages = companyBriefResult.pages_used?.length
    ? companyBriefResult.pages_used
    : [];

  const crawledPagesList = usedPages.map(url => ({
    url,
    title: `${companyName} Web Resource`
  }));

  const processStepsList = (interviewResearchResult.found && interviewResearchResult.process_steps?.length)
    ? interviewResearchResult.process_steps.map((step, idx) => ({
        round_name: typeof step === 'string' ? step : `Round ${idx + 1}`,
        description: 'Structured assessment evaluating role requirements and core candidate competencies.'
      }))
    : [];

  // Derive overall data quality
  const isThinJd = stage1Result.is_thin_jd || false;
  const companyResearchAvailable = companyBriefResult.company_research_available !== false;
  let overallDataQuality = 'full';
  if (isThinJd && !companyResearchAvailable) overallDataQuality = 'none';
  else if (isThinJd || !companyResearchAvailable) overallDataQuality = 'thin';
  else if (companyBriefResult.data_quality === 'partial') overallDataQuality = 'partial';

  const rawKit = {
    source: {
      company: companyName,
      company_url: companyUrl || '',
      role: roleTitle,
      location: 'Remote / On-site',
      jd_chars: (jd || '').length,
      is_thin_jd: isThinJd,
      jd_quality_note: stage1Result.jd_quality_note || '',
      data_quality: overallDataQuality,
      researched_at: new Date().toISOString(),
      pages_used: usedPages
    },
    company_brief: {
      summary: companyBriefResult.summary || (companyResearchAvailable
        ? 'No public company details found.'
        : `No public information could be retrieved from the company site. The brief below is based solely on the job description.`),
      what_they_do: companyBriefResult.what_they_do || (companyResearchAvailable
        ? 'No product or tech stack details found.'
        : 'Company site was not accessible or contained no parseable content.'),
      sources: usedPages,
      company_research_available: companyResearchAvailable,
      status: 'generated'
    },
    role: {
      title: roleTitle,
      seniority: stage1Result.seniority || 'Mid-Senior',
      responsibilities: stage1Result.responsibilities || [],
      requirements
    },
    questions: secondPassResult.questions,
    flashcards,
    schedule: scheduleResult,
    coverage: secondPassResult.coverage,
    research: {
      crawled_pages: crawledPagesList,
      skipped_pages: companyBriefResult.pages_skipped || [],
      process_steps: processStepsList,
      insights: (interviewResearchResult.found && interviewResearchResult.key_insights?.length)
        ? interviewResearchResult.key_insights
        : [
            'No public interview discussion records found for this company. Kit generated using job description synthesis.'
          ]
    }
  };

  // Validate with Zod schema
  const validation = kitSchema.safeParse(rawKit);
  if (!validation.success) {
    logger.warn('[Kit Pipeline] Zod validation failed on raw generated kit:', validation.error.message);
    return rawKit;
  }

  return validation.data;
}
