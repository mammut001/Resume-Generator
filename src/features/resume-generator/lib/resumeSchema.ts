import { z } from 'zod';
import { ResumeData, ResumeVersion } from '@/types/resume';
import { resumeDesignDefaults } from '../data/resumeDesign';

export const resumePersonalSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  headline: z.string().min(1, 'Headline is required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  location: z.string().optional(),
  website: z.string().optional(),
  linkedin: z.string().optional(),
  github: z.string().optional(),
});

export const resumeExperienceSchema = z.object({
  id: z.string(),
  company: z.string().min(1, 'Company is required'),
  role: z.string().min(1, 'Role is required'),
  location: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  current: z.boolean().optional(),
  bullets: z.array(z.string()).default([]),
});

export const resumeEducationSchema = z.object({
  id: z.string(),
  school: z.string().min(1, 'School is required'),
  degree: z.string().min(1, 'Degree is required'),
  field: z.string().optional(),
  location: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  details: z.array(z.string()).optional(),
});

export const resumeSkillSchema = z.object({
  id: z.string(),
  category: z.string().min(1, 'Category is required'),
  items: z.array(z.string()).min(1, 'At least one skill is required'),
});

export const resumeProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
  url: z.string().optional(),
  bullets: z.array(z.string()).default([]),
});

export const resumeDesignSchema = z.object({
  typography: z.enum(['classic', 'sans', 'mono']).default(resumeDesignDefaults.typography),
  density: z.enum(['compact', 'comfortable', 'spacious']).default(resumeDesignDefaults.density),
  pageSize: z.enum(['letter', 'a4']).default(resumeDesignDefaults.pageSize),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default(resumeDesignDefaults.accentColor),
});

export const resumeDataSchema = z.object({
  id: z.string(),
  title: z.string().min(1, 'Title is required'),
  templateId: z.string().min(1, 'Template ID is required'),
  design: resumeDesignSchema.optional().default(resumeDesignDefaults),
  personal: resumePersonalSchema,
  summary: z.string().optional().default(''),
  experience: z.array(resumeExperienceSchema).default([]),
  education: z.array(resumeEducationSchema).default([]),
  skills: z.array(resumeSkillSchema).default([]),
  projects: z.array(resumeProjectSchema).default([]),
});

export const resumeVersionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  label: z.string(),
  resume: resumeDataSchema,
  typstSource: z.string(),
});

export function validateResumeData(data: unknown): ResumeData | null {
  try {
    return resumeDataSchema.parse(data) as ResumeData;
  } catch {
    return null;
  }
}

export function validateResumeVersion(data: unknown): ResumeVersion | null {
  try {
    return resumeVersionSchema.parse(data) as ResumeVersion;
  } catch {
    return null;
  }
}