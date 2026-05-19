import { DEFAULT_LOCALE, type SupportedLocale } from '@/i18n';
import { ResumeData } from '@/types/resume';
import { resumeDesignDefaults } from './resumeDesign';

export const defaultResume: ResumeData = {
  id: 'default-resume',
  title: 'Frontend Engineer Resume',
  templateId: 'clean-professional',
  design: { ...resumeDesignDefaults },
  personal: {
    fullName: 'Alex Chen',
    headline: 'Product-Minded Frontend Engineer',
    email: 'alex.chen@email.com',
    phone: '+1 (555) 123-4567',
    location: 'San Francisco, CA',
    linkedin: 'linkedin.com/in/alexchen',
    github: 'github.com/alexchen',
    website: 'alexchen.dev',
  },
  summary: 'Frontend engineer with 5+ years of experience building polished, user-centric web applications. Passionate about clean code, accessibility, and performant interfaces. Experience leading teams and shipping products used by millions.',
  experience: [
    {
      id: 'exp-1',
      company: 'TechCorp',
      role: 'Senior Frontend Engineer',
      location: 'San Francisco, CA',
      startDate: 'Jan 2022',
      endDate: '',
      current: true,
      bullets: [
        'Led frontend architecture for the core product, improving load times by 40% and reducing bundle size by 30%.',
        'Mentored 4 junior engineers and established code review practices that improved code quality across the team.',
        'Built a reusable component library adopted by 3 product teams, reducing development time by 25%.',
      ],
    },
    {
      id: 'exp-2',
      company: 'StartupXYZ',
      role: 'Frontend Engineer',
      location: 'Remote',
      startDate: 'Jun 2019',
      endDate: 'Dec 2021',
      current: false,
      bullets: [
        'Developed and shipped the company\'s flagship web application from scratch using React and TypeScript.',
        'Implemented responsive design system that improved mobile user engagement by 60%.',
        'Collaborated with designers to create pixel-perfect, accessible UI components.',
      ],
    },
  ],
  education: [
    {
      id: 'edu-1',
      school: 'University of California, Berkeley',
      degree: 'Bachelor of Science',
      field: 'Computer Science',
      location: 'Berkeley, CA',
      startDate: '2015',
      endDate: '2019',
    },
  ],
  skills: [
    {
      id: 'skill-1',
      category: 'Languages',
      items: ['TypeScript', 'JavaScript', 'HTML', 'CSS', 'Python'],
    },
    {
      id: 'skill-2',
      category: 'Frameworks & Libraries',
      items: ['React', 'Next.js', 'Vue.js', 'Tailwind CSS', 'Framer Motion'],
    },
    {
      id: 'skill-3',
      category: 'Tools & Practices',
      items: ['Git', 'Webpack', 'Jest', 'Playwright', 'Figma', 'CI/CD'],
    },
  ],
  projects: [
    {
      id: 'proj-1',
      name: 'OpenSource UI Kit',
      description: 'A customizable, accessible React component library with 2k+ GitHub stars.',
      url: 'github.com/alexchen/ui-kit',
      bullets: [
        'Built 50+ components with full TypeScript support and comprehensive documentation.',
        'Integrated Storybook for visual testing and documentation, reducing review time by 30%.',
      ],
    },
    {
      id: 'proj-2',
      name: 'Portfolio Site',
      description: 'Personal website showcasing projects and blog posts.',
      url: 'alexchen.dev',
      bullets: [
        'Built with Next.js and deployed on Vercel with 95+ Lighthouse score.',
        'Implemented server-side rendering and image optimization for fast load times.',
      ],
    },
  ],
};

export const defaultResumeZhCN: ResumeData = {
  id: 'default-resume-zh-cn',
  title: '前端工程师简历',
  templateId: 'clean-professional',
  design: { ...resumeDesignDefaults },
  personal: {
    fullName: '陈晨',
    headline: '注重产品体验的前端工程师',
    email: 'chen.chen@email.com',
    phone: '+86 138 1234 5678',
    location: '上海，中国',
    linkedin: 'linkedin.com/in/chenchen',
    github: 'github.com/chenchen',
    website: 'chenchen.dev',
  },
  summary: '拥有 5 年以上经验的前端工程师，长期专注于打磨精致、面向用户的 Web 应用。关注代码质量、无障碍和性能优化，具备带领团队与推动产品落地的经验。',
  experience: [
    {
      id: 'exp-1',
      company: '星云科技',
      role: '高级前端工程师',
      location: '上海，中国',
      startDate: '2022 年 1 月',
      endDate: '',
      current: true,
      bullets: [
        '负责核心产品的前端架构升级，将首屏加载时间缩短 40%，同时减少 30% 的打包体积。',
        '辅导 4 名初级工程师，并建立代码评审机制，持续提升团队交付质量。',
        '搭建可复用组件库，被 3 个产品团队采用，整体开发效率提升 25%。',
      ],
    },
    {
      id: 'exp-2',
      company: '火箭创新',
      role: '前端工程师',
      location: '远程',
      startDate: '2019 年 6 月',
      endDate: '2021 年 12 月',
      current: false,
      bullets: [
        '使用 React 与 TypeScript 从零开发公司的核心 Web 应用并完成上线。',
        '建立响应式设计体系，使移动端用户参与度提升 60%。',
        '与设计师紧密合作，交付像素级还原且具备无障碍能力的 UI 组件。',
      ],
    },
  ],
  education: [
    {
      id: 'edu-1',
      school: '加州大学伯克利分校',
      degree: '理学学士',
      field: '计算机科学',
      location: '伯克利，美国',
      startDate: '2015',
      endDate: '2019',
    },
  ],
  skills: [
    {
      id: 'skill-1',
      category: '编程语言',
      items: ['TypeScript', 'JavaScript', 'HTML', 'CSS', 'Python'],
    },
    {
      id: 'skill-2',
      category: '框架与库',
      items: ['React', 'Next.js', 'Vue.js', 'Tailwind CSS', 'Framer Motion'],
    },
    {
      id: 'skill-3',
      category: '工具与实践',
      items: ['Git', 'Webpack', 'Jest', 'Playwright', 'Figma', 'CI/CD'],
    },
  ],
  projects: [
    {
      id: 'proj-1',
      name: '开源 UI 组件库',
      description: '一个可定制、可访问的 React 组件库，在 GitHub 上获得了 2k+ Star。',
      url: 'github.com/chenchen/ui-kit',
      bullets: [
        '构建了 50+ 个完整支持 TypeScript 的组件，并配套完善文档。',
        '接入 Storybook 用于可视化测试与文档展示，将设计评审时间缩短 30%。',
      ],
    },
    {
      id: 'proj-2',
      name: '个人作品站',
      description: '用于展示项目与博客文章的个人网站。',
      url: 'chenchen.dev',
      bullets: [
        '基于 Next.js 构建，并部署到 Vercel，Lighthouse 分数稳定在 95+。',
        '实现服务端渲染与图片优化，保障页面加载速度。',
      ],
    },
  ],
};

const localizedDefaultResumes: Record<SupportedLocale, ResumeData> = {
  en: defaultResume,
  'zh-CN': defaultResumeZhCN,
};

export function getDefaultResume(locale: SupportedLocale = DEFAULT_LOCALE): ResumeData {
  return JSON.parse(JSON.stringify(localizedDefaultResumes[locale] || localizedDefaultResumes[DEFAULT_LOCALE])) as ResumeData;
}