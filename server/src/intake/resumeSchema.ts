import { z } from 'zod';
import { RenderHttpError } from '../lib/errors.js';
import { ResumeIntakeResult } from './types.js';

const resumeDesignSchema = z.object({
  typography: z.enum(['classic', 'sans', 'mono']),
  density: z.enum(['compact', 'comfortable', 'spacious']),
  pageSize: z.enum(['letter', 'a4']),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const resumePersonalSchema = z.object({
  fullName: z.string().min(1),
  headline: z.string().min(1),
  email: z.string().email().or(z.literal('')),
  phone: z.string(),
  location: z.string(),
  website: z.string().optional(),
  linkedin: z.string().optional(),
  github: z.string().optional(),
});

const resumeExperienceSchema = z.object({
  id: z.string().min(1),
  company: z.string().min(1),
  role: z.string().min(1),
  location: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  current: z.boolean().optional(),
  bullets: z.array(z.string()),
});

const resumeEducationSchema = z.object({
  id: z.string().min(1),
  school: z.string().min(1),
  degree: z.string().min(1),
  field: z.string().optional(),
  location: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  details: z.array(z.string()).optional(),
});

const resumeSkillSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  items: z.array(z.string()).min(1),
});

const resumeProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  url: z.string().optional(),
  bullets: z.array(z.string()),
});

const resumeDataSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  templateId: z.string().min(1),
  design: resumeDesignSchema,
  personal: resumePersonalSchema,
  summary: z.string(),
  experience: z.array(resumeExperienceSchema),
  education: z.array(resumeEducationSchema),
  skills: z.array(resumeSkillSchema),
  projects: z.array(resumeProjectSchema),
});

const confidenceSchema = z.number().min(0).max(1);

const resumeIntakeResultSchema = z.object({
  resume: resumeDataSchema,
  confidence: z.object({
    overall: confidenceSchema,
    sections: z.object({
      personal: confidenceSchema,
      summary: confidenceSchema,
      experience: confidenceSchema,
      education: confidenceSchema,
      skills: confidenceSchema,
      projects: confidenceSchema,
    }),
  }),
  warnings: z.array(z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    fieldPath: z.string().optional(),
  })),
  source: z.object({
    kind: z.enum(['pdf', 'paragraph']),
    extractedText: z.string().optional(),
  }),
});

export function validateResumeIntakeResult(result: ResumeIntakeResult): ResumeIntakeResult {
  const parsed = resumeIntakeResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new RenderHttpError(500, 'INTERNAL_ERROR', 'Generated intake result failed schema validation.');
  }

  return parsed.data as ResumeIntakeResult;
}