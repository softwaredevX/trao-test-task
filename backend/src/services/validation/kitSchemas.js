import { z } from 'zod';

export const requirementSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(['technical', 'behavioural', 'domain']),
  priority: z.enum(['must', 'nice'])
});

export const questionSchema = z.object({
  id: z.string(),
  requirement_ids: z.array(z.string()),
  category: z.enum(['technical', 'behavioural', 'system-design', 'company-fit']),
  prompt: z.string(),
  answer_outline: z.string().default(''),
  difficulty: z.number().int().min(1).max(3),
  status: z.enum(['generated', 'edited', 'pinned']).default('generated')
});

export const flashcardSchema = z.object({
  id: z.string(),
  front: z.string(),
  back: z.string(),
  requirement_ids: z.array(z.string()),
  status: z.enum(['generated', 'edited', 'pinned']).default('generated')
});

export const dayScheduleSchema = z.object({
  day: z.number().int().min(1),
  focus: z.string(),
  question_ids: z.array(z.string()),
  minutes: z.number().int().nonnegative()
});

export const kitSchema = z.object({
  source: z.object({
    company: z.string().default(''),
    company_url: z.string().default(''),
    role: z.string().default(''),
    location: z.string().default(''),
    jd_chars: z.number().int().nonnegative().default(0),
    researched_at: z.string().default(''),
    pages_used: z.array(z.string()).default([])
  }),
  company_brief: z.object({
    summary: z.string().default(''),
    what_they_do: z.string().default(''),
    sources: z.array(z.string()).default([]),
    status: z.enum(['generated', 'edited', 'pinned']).default('generated')
  }),
  role: z.object({
    title: z.string().default(''),
    seniority: z.string().default(''),
    responsibilities: z.array(z.string()).default([]),
    requirements: z.array(requirementSchema)
  }),
  questions: z.array(questionSchema),
  flashcards: z.array(flashcardSchema),
  schedule: z.object({
    days_available: z.number().int().min(1).max(60),
    days: z.array(dayScheduleSchema)
  }),
  coverage: z.object({
    uncovered_requirement_ids: z.array(z.string()).default([]),
    passes: z.number().int().min(1).default(1)
  })
});
