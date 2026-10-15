import { readFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { createApp } from '../src/app.js';
import { extractTextFromPdfBuffer } from '../src/intake/pdfIntake.js';
import { sanitizeIntakeResume } from '../src/intake/resumeFidelity.js';
import { buildResumeDraftFromParagraph, buildResumeDraftFromPdfText } from '../src/intake/textIntakeService.js';
import { ResumeData, ResumeIntakeResult } from '../src/intake/types.js';

const latinFontBytes = readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
const cjkFontBytes = readFileSync('/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf');

const personas = [
  {
    file: '01-maya-chen-newgrad.txt',
    dir: 'personas',
    name: 'Maya Chen',
    headline: 'Software Engineer',
    email: 'maya.chen@email.com',
    phone: '+1 (415) 555-0142',
    location: 'San Francisco, CA',
    linkedin: 'linkedin.com/in/mayachen',
    github: 'github.com/mayachen',
    companies: ['Stripe', 'UC Berkeley EECS'],
    schools: ['University of California, Berkeley'],
    projects: ['CampusConnect'],
    skillItems: ['TypeScript', 'Python', 'Java', 'SQL', 'React', 'Node.js', 'PostgreSQL', 'Git', 'Docker'],
    extraText: ['GPA: 3.7/4.0', 'Undergraduate Researcher'],
  },
  {
    file: '02-jordan-okonkwo-pm.txt',
    dir: 'personas',
    name: 'Jordan Okonkwo',
    headline: 'Product Manager',
    email: 'jordan.okonkwo@email.com',
    phone: '+1 (646) 555-0198',
    location: 'New York, NY',
    linkedin: 'linkedin.com/in/jordanokonkwo',
    website: 'jordanokonkwo.com',
    companies: ['Notion', 'Dropbox', 'Deloitte Digital'],
    schools: ['NYU Stern School of Business', 'University of Michigan'],
    projects: [],
    skillItems: ['Roadmapping', 'A/B testing', 'Jira', 'Amplitude', 'Figma', 'SQL'],
    extraText: ['Business Analyst'],
  },
  {
    file: '03-priya-nair-data.txt',
    dir: 'personas',
    name: 'Priya Nair',
    headline: 'Data Analyst',
    email: 'priya.nair@email.com',
    phone: '+1 (312) 555-0173',
    location: 'Chicago, IL',
    linkedin: 'linkedin.com/in/priyanair',
    github: 'github.com/priyanair',
    companies: ['Shopify', 'Instacart', 'Zendesk'],
    schools: ['Coursera', 'University of Illinois Chicago'],
    projects: ['Retail Demand Forecast Notebook'],
    skillItems: ['SQL', 'Python', 'Looker', 'Tableau', 'Excel', 'stakeholder communication'],
    extraText: ['Customer Success Associate'],
  },
  {
    file: '04-wei-zhang-senior.txt',
    dir: 'personas',
    name: 'Wei Zhang',
    headline: 'Senior Backend Engineer',
    email: 'wei.zhang@email.com',
    phone: '+1 (206) 555-0110',
    location: 'Seattle, WA',
    linkedin: 'linkedin.com/in/weizhang',
    github: 'github.com/weizhang-dev',
    companies: ['Amazon', 'Alibaba Cloud'],
    schools: ['Zhejiang University', 'Huazhong University of Science and Technology'],
    projects: ['OpenTelemetry Sampler Plugin'],
    skillItems: ['Go', 'Java', 'Kafka', 'PostgreSQL', 'Kubernetes', 'observability'],
    extraText: ['Hangzhou, China'],
  },
  {
    file: '05-sofia-martinez-design.txt',
    dir: 'personas',
    name: 'Sofia Martinez',
    headline: 'Product Designer',
    email: 'sofia.martinez@email.com',
    phone: '+1 (323) 555-0166',
    location: 'Los Angeles, CA',
    linkedin: 'linkedin.com/in/sofiamartinez',
    website: 'sofiam.design',
    companies: ['Spotify', 'Airbnb', 'Agency Indie Lab'],
    schools: ['ArtCenter College of Design'],
    projects: [],
    skillItems: ['Figma', 'prototyping', 'accessibility (WCAG)', 'FigJam'],
    extraText: ['UI/UX Designer'],
  },
  {
    file: '01-li-xiaoran-ops.txt',
    dir: 'personas-zh',
    name: '李晓然',
    headline: '互联网产品运营',
    email: 'li.xiaoran@email.com',
    phone: '138-0000-1201',
    location: '上海',
    linkedin: 'linkedin.com/in/lixiaoran',
    companies: ['字节跳动（抖音电商）', '小红书'],
    schools: ['复旦大学'],
    projects: ['校园二手交易小程序运营'],
    skillItems: ['数据分析（Excel / SQL 基础）', '活动策划', '飞书多维表格', 'Notion'],
    extraText: ['GPA 3.6/4.0', '用户运营实习生'],
  },
  {
    file: '02-chen-hao-frontend.txt',
    dir: 'personas-zh',
    name: '陈昊',
    headline: '前端工程师',
    email: 'chenhao.dev@email.com',
    phone: '186-0000-3344',
    location: '杭州',
    github: 'github.com/chenhao-fe',
    website: 'chenhao.dev',
    companies: ['阿里巴巴（淘宝技术）', '网易'],
    schools: ['浙江大学'],
    projects: ['开源表格组件 ProTable Lite'],
    skillItems: ['TypeScript', 'React', 'Next.js', 'Webpack/Vite', '微前端'],
    extraText: ['首屏加载时间下降 35%', '微前端架构试点'],
  },
  {
    file: '03-wang-yuting-analyst.txt',
    dir: 'personas-zh',
    name: '王雨婷',
    headline: '数据分析师',
    email: 'wang.yuting@email.com',
    phone: '159-0000-7788',
    location: '北京',
    companies: ['京东零售', '拼多多'],
    schools: ['对外经济贸易大学', '网易云课堂 / 自研 SQL 专项'],
    projects: ['零售销量预测 Notebook'],
    skillItems: ['SQL', 'Python（pandas）', 'Tableau', 'A/B 测试'],
    extraText: ['从电商运营转型数据分析'],
  },
  {
    file: '04-zhao-mingxuan-ml.txt',
    dir: 'personas-zh',
    name: '赵明轩',
    headline: '机器学习工程师（应届）',
    email: 'zhao.mingxuan@email.com',
    phone: '137-0000-5566',
    location: '深圳',
    github: 'github.com/zhaomx-ml',
    companies: ['腾讯（优图实验室）', '中山大学计算机学院'],
    schools: ['中山大学', '华南理工大学'],
    projects: ['开源检测训练脚手架'],
    skillItems: ['Python', 'PyTorch', 'ONNX', 'CUDA 基础', '实验管理'],
    extraText: ['研究助理', 'Top-1 召回提升 3.2 个百分点'],
  },
] as const;

describe('structured resume intake', () => {
  let server: Server | undefined;
  let baseUrl = '';

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server?.close(error => (error ? reject(error) : resolve()));
    });
    server = undefined;
    baseUrl = '';
  });

  it.each(personas)('keeps every pasted section for $name', async (persona) => {
    const text = readPersona(persona.dir, persona.file);
    const draft = await buildResumeDraftFromParagraph(text);
    expectFaithful(text, draft, persona);
    expect(draft.warnings.some(warning => warning.code === 'MODEL_GATEWAY_FAILED')).toBe(false);
  });

  it.each(personas)('keeps every section when a configured model would have dropped it for $name', async (persona) => {
    const text = readPersona(persona.dir, persona.file);
    let modelCalls = 0;
    const draft = await buildResumeDraftFromParagraph(text, {
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'test-key',
      model: 'MiniMax-M2.7',
      fetchImpl: async () => {
        modelCalls += 1;
        return new Response('not called', { status: 500 });
      },
    });

    expect(modelCalls).toBe(0);
    expectFaithful(text, draft, persona);
    expect(draft.warnings.some(warning => warning.code === 'MODEL_GATEWAY_NOT_CONFIGURED')).toBe(false);
  });

  it.each(personas)('keeps every section from a text PDF for $name', async (persona) => {
    const text = readPersona(persona.dir, persona.file);
    const extracted = await extractTextFromPdfBuffer(await createResumePdf(text));
    expect(extracted.text).not.toMatch(/--\s*\d+\s+of\s+\d+\s*--/);
    const draft = await buildResumeDraftFromPdfText(extracted.text);
    expect(draft.source.kind).toBe('pdf');
    expectFaithful(text, draft, persona);
  });

  it('repairs mangled model output for prose that is not a sectioned resume', async () => {
    const source = 'Zhao Mingxuan builds PyTorch models. zhao.mingxuan@email.com github.com/zhaomx-ml';
    const mangled = resumeSkeleton({
      personal: {
        fullName: '赵明轩',
        headline: '机器学习工程师',
        email: 'zhao.mingxuan@email.com',
        phone: '',
        location: '',
        website: 'email.com',
        github: 'github.com/zhaomx-ml',
      },
      summary: '赵明轩是一名计算机视觉方向硕士应届生，熟悉 PyTorch。',
      skills: [{ id: 'skill-1', category: 'Detected Skills', items: ['Python', 'PyTorch'] }],
      projects: [{
        id: 'project-1',
        name: '统一配置、日志与可视化，支持多卡训练与断点续训, 开源检测训练脚手架',
        description: '统一配置、日志与可视化，支持多卡训练与断点续训',
        bullets: ['统一配置、日志与可视化，支持多卡训练与断点续训 统一配置、日志与可视化，支持多卡训练与断点续训'],
      }],
      experience: [{
        id: 'exp-1',
        company: '腾讯',
        role: '算法实习生',
        startDate: '2025.05',
        endDate: '2025.10',
        current: false,
        bullets: ['参与商品图像检索模型优化，Top-1 召回提升 3.2 个百分点; 完成模型量化与推理加速，单卡吞吐提升约 1.8 倍'],
      }],
    });

    const sourceWithBullets = `${source}
- 参与商品图像检索模型优化，Top-1 召回提升 3.2 个百分点
- 完成模型量化与推理加速，单卡吞吐提升约 1.8 倍
计算机视觉方向硕士应届生，熟悉 PyTorch。`;

    const sanitized = sanitizeIntakeResume(mangled, sourceWithBullets);

    expect(sanitized.personal.website).toBeUndefined();
    expect(sanitized.personal.github).toBe('github.com/zhaomx-ml');
    expect(sanitized.skills[0].category).not.toBe('Detected Skills');
    expect(sanitized.summary.startsWith('赵明轩')).toBe(false);
    expect(sanitized.summary).toContain('计算机视觉方向硕士应届生');
    expect(sanitized.projects[0].name).toBe('开源检测训练脚手架');
    expect(sanitized.projects[0].description).toBe('');
    expect(sanitized.projects[0].bullets).toEqual(['统一配置、日志与可视化，支持多卡训练与断点续训']);
    expect(sanitized.experience[0].bullets).toEqual([
      '参与商品图像检索模型优化，Top-1 召回提升 3.2 个百分点',
      '完成模型量化与推理加速，单卡吞吐提升约 1.8 倍',
    ]);
  });

  it('reads bilingual headings and a mixed Chinese-English name', async () => {
    const text = `林嘉怡 Jiayi Lin
Product Designer
jiayi.lin@email.com | +1 (415) 555-0100 | 上海
linkedin.com/in/jiayilin | jiayilin.design | dribbble.com/jiayi

EXPERIENCE / 工作经历
Product Designer — Figma (San Francisco, CA)
Jan 2022 – Present
- Shipped a component spec used by 12 teams

SKILLS / 技能
Product: Figma, prototyping
Tools: Jira, Notion`;

    const draft = await buildResumeDraftFromParagraph(text);
    expect(draft.resume.personal.fullName).toBe('林嘉怡 Jiayi Lin');
    expect(draft.resume.personal.headline).toBe('Product Designer');
    expect(draft.resume.personal.website).toBe('jiayilin.design');
    expect(draft.resume.personal.extraLink).toBe('dribbble.com/jiayi');
    expect(draft.resume.experience.map(entry => entry.company)).toEqual(['Figma']);
    expect(draft.resume.experience[0].role).toBe('Product Designer');
    expect(draft.resume.experience[0].startDate).toBe('Jan 2022');
    expect(draft.resume.experience[0].current).toBe(true);
    expect(draft.resume.skills.map(group => group.category)).toEqual(['Product', 'Tools']);
    expect(draft.resume.skills[1].items).toContain('Jira');
    expect(draft.resume.design.pageSize).toBe('a4');
  });

  it('joins a wrapped bullet continuation onto the previous bullet', async () => {
    const text = `Jordan Okonkwo
Product Manager
jordan.okonkwo@email.com | +1 (646) 555-0198 | New York, NY

EXPERIENCE
Product Manager — Notion (New York, NY)
Mar 2023 – Present
- Owned permissions and sharing roadmap; grew weekly active
collaborative sessions by 19%

SKILLS
Tools: Jira`;

    const draft = await buildResumeDraftFromParagraph(text);
    expect(draft.resume.experience[0].bullets).toEqual([
      'Owned permissions and sharing roadmap; grew weekly active collaborative sessions by 19%',
    ]);
  });

  it('keeps a second school when education is stacked without a location column', async () => {
    const text = `Jordan Okonkwo
Product Manager
jordan.okonkwo@email.com | +1 (646) 555-0198 | New York, NY

EDUCATION
University of Michigan
B.A. Economics
2015 – 2019
NYU Stern School of Business
MBA
2019 – 2021

SKILLS
Tools: Jira`;

    const draft = await buildResumeDraftFromParagraph(text);
    expect(draft.resume.education.map(entry => entry.school)).toEqual([
      'University of Michigan',
      'NYU Stern School of Business',
    ]);
    expect(draft.resume.education.map(entry => entry.degree)).toEqual(['B.A. Economics', 'MBA']);
    expect(draft.resume.education.map(entry => entry.endDate)).toEqual(['2019', '2021']);

    const extracted = await extractTextFromPdfBuffer(await createResumePdf(text));
    const fromPdf = await buildResumeDraftFromPdfText(extracted.text);
    expect(fromPdf.resume.education.map(entry => entry.school)).toEqual([
      'University of Michigan',
      'NYU Stern School of Business',
    ]);
    expect(fromPdf.resume.education.map(entry => entry.degree)).toEqual(['B.A. Economics', 'MBA']);
  });

  it('extracts jobs, schools, and skills from heading-less prose when the model gateway fails', async () => {
    const text = 'Priya Nair is a data analyst in Chicago. She has been a Data Analyst at Shopify since 2021, building dashboards. Previously she was a Business Analyst at Zendesk from 2019 to 2021. She earned a B.S. in Information Systems from the University of Illinois Chicago. Skills include SQL, Python, Tableau, and Excel. priya.nair@email.com';
    const draft = await buildResumeDraftFromParagraph(text, {
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'test-key',
      model: 'MiniMax-M2.7',
      fetchImpl: async () => new Response('unavailable', { status: 503 }),
    });

    expect(draft.warnings.some(warning => warning.code === 'MODEL_GATEWAY_FAILED')).toBe(true);
    expect(draft.resume.experience.map(entry => entry.company)).toEqual(expect.arrayContaining(['Shopify', 'Zendesk']));
    expect(draft.resume.education.map(entry => entry.school)).toContain('University of Illinois Chicago');
    expect(draft.resume.skills.flatMap(group => group.items)).toEqual(expect.arrayContaining(['SQL', 'Python', 'Tableau', 'Excel']));
    expect(draft.resume.summary).not.toMatch(/background described/i);
    expect(draft.resume.summary.toLowerCase()).toContain('data analyst');
    expect(draft.resume.summary).not.toMatch(/@/);
  });

  it('extracts lowercase heading-less prose without putting contact details in the summary', async () => {
    const text = 'alex chen builds data tools for finance teams and likes careful pipelines. email alex.chen@example.com, phone +1 (415) 555-0134. he worked at stripe since 2020 as a data engineer, and interned at google in 2019. he graduated from carnegie mellon university with a b.s. in computer science. side project: Ledger, an open-source invoice reconciler. skills: Python, SQL, Spark.';
    const draft = await buildResumeDraftFromParagraph(text, {
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'test-key',
      model: 'MiniMax-M2.7',
      fetchImpl: async () => new Response('unavailable', { status: 503 }),
    });

    expect(draft.warnings.some(warning => warning.code === 'MODEL_GATEWAY_FAILED')).toBe(true);
    expect(draft.resume.experience.map(entry => entry.company)).toEqual(expect.arrayContaining(['Stripe', 'Google']));
    expect(draft.resume.experience.find(entry => entry.company === 'Stripe')?.role).toBe('Data Engineer');
    expect(draft.resume.education.map(entry => entry.school)).toContain('Carnegie Mellon University');
    expect(draft.resume.education[0]?.degree.toLowerCase()).toContain('computer science');
    expect(draft.resume.projects.map(project => project.name)).toContain('Ledger');
    expect(draft.resume.skills.flatMap(group => group.items)).toEqual(expect.arrayContaining(['Python', 'SQL', 'Spark']));
    expect(draft.resume.summary[0]).toBe(draft.resume.summary[0].toUpperCase());
    expect(draft.resume.summary).not.toMatch(/@|415|555/);
    expect(draft.resume.summary.toLowerCase()).toContain('data tools');
  });

  it('keeps an underscored name, a following headline, and a social handle', async () => {
    const text = `Sam O'Neil_Test
DevRel Engineer
@samoneil on X | sam.oneil@example.com | (512) 555-0148 | Austin, TX

SUMMARY
Closes developer-led pipeline.

EXPERIENCE
DevRel Engineer — Ledgerly
May 2021 – Present
- Launched the sample app

EDUCATION
B.S. Electrical and Computer Engineering — University of Texas at Austin
May 2020`;
    const draft = await buildResumeDraftFromParagraph(text);

    expect(draft.resume.personal.fullName).toBe("Sam O'Neil_Test");
    expect(draft.resume.personal.headline).toBe('DevRel Engineer');
    expect(draft.resume.personal.extraLink).toBe('@samoneil on X');
    expect(draft.resume.personal.location).toBe('Austin, TX');
    expect(draft.resume.personal.email).toBe('sam.oneil@example.com');
    expect(draft.warnings.some(warning => warning.code === 'MISSING_NAME')).toBe(false);
    expect(draft.resume.experience.map(entry => entry.company)).toContain('Ledgerly');
  });

  it('extracts heading-less prose without contact residue, truncated words, or a mangled degree', async () => {
    const text = [
      "Sam O'Neil_Test, DevRel Engineer in Austin, TX.",
      '@samoneil on X.',
      '(512) 555-0148,, sam.oneil@example.com.',
      'He closed $3M in developer-led pipeline by teaching API design to product teams and writing the migration guide.',
      `${'beta '.repeat(120)}review the draft carefully.`,
      'He worked at Northwind as a Software Engineer from 2018 to 2021 and shipped the billing API.',
      'He then joined Ledgerly as a DevRel Engineer from May 2021 to present and launched the sample app.',
      'He graduated from the University of Texas at Austin with a B.S. in Electrical and Computer Engineering in May 2020.',
      'Project: OpenAPI Diff, a CLI for breaking changes.',
      'Skills: Python, Go, TypeScript, public speaking.',
    ].join(' ');
    const draft = await buildResumeDraftFromParagraph(text, {
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'test-key',
      model: 'MiniMax-M2.7',
      fetchImpl: async () => new Response('unavailable', { status: 503 }),
    });
    const { resume } = draft;
    const northwind = resume.experience.find(entry => entry.company === 'Northwind');
    const ledgerly = resume.experience.find(entry => entry.company === 'Ledgerly');
    const education = resume.education[0];

    expect(draft.warnings.some(warning => warning.code === 'MISSING_NAME')).toBe(false);
    expect(resume.personal.fullName).toBe("Sam O'Neil_Test");
    expect(resume.personal.headline).toBe('DevRel Engineer');
    expect(resume.personal.extraLink).toBe('@samoneil on X');
    expect(resume.personal.location).toBe('Austin, TX');
    expect(resume.summary).toContain('$3M in developer');
    expect(resume.summary).not.toContain('(,,');
    expect(resume.summary).not.toMatch(/\$3M in d(?!eveloper)/);
    expect(resume.summary).not.toMatch(/@|555-0148|\(512\)/);
    expect(resume.summary.split(/\s+/).at(-1)).toMatch(/^[A-Za-z0-9$.,]+$/);
    expect(northwind?.role).toBe('Software Engineer');
    expect(northwind?.startDate).toBe('2018');
    expect(northwind?.endDate).toBe('2021');
    expect(northwind?.bullets.join(' ')).toMatch(/billing API/i);
    expect(ledgerly?.role).toBe('DevRel Engineer');
    expect(ledgerly?.startDate).toBe('May 2021');
    expect(ledgerly?.current).toBe(true);
    expect(ledgerly?.bullets.join(' ')).toMatch(/sample app/i);
    expect(education?.school).toBe('University of Texas at Austin');
    expect(education?.degree).toBe('B.S. in Electrical and Computer Engineering');
    expect(education?.endDate).toBe('May 2020');
    expect(education?.degree).not.toMatch(/B\.S\.\.| In | And /);
    expect(resume.skills.flatMap(group => group.items)).toEqual(expect.arrayContaining(['Python', 'Go', 'TypeScript', 'public speaking']));
    expect(resume.projects.map(project => project.name)).toContain('OpenAPI Diff');
  });

  it('extracts Chinese prose jobs and schools when the model gateway fails', async () => {
    const text = '我是李晓然，在字节跳动担任产品运营。2021 年至今就职于小红书。毕业于复旦大学。熟悉 Excel、SQL 和活动策划。li.xiaoran@email.com';
    const draft = await buildResumeDraftFromParagraph(text, {
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'test-key',
      model: 'MiniMax-M2.7',
      fetchImpl: async () => {
        throw new Error('gateway down');
      },
    });

    expect(draft.warnings.some(warning => warning.code === 'MODEL_GATEWAY_FAILED')).toBe(true);
    expect(draft.resume.experience.map(entry => entry.company)).toEqual(expect.arrayContaining(['字节跳动', '小红书']));
    expect(draft.resume.education.map(entry => entry.school)).toContain('复旦大学');
    expect(draft.resume.skills.flatMap(group => group.items).join(' ')).toMatch(/Excel/);
    expect(draft.resume.design.pageSize).toBe('a4');
    expect(draft.resume.summary).not.toMatch(/background described/i);
  });

  it('accepts a pasted persona through the intake route', async () => {
    const text = readPersona('personas', '01-maya-chen-newgrad.txt');
    await startServer();

    const response = await fetch(`${baseUrl}/api/intake/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const payload = await response.json() as ResumeIntakeResult;

    expect(response.status).toBe(200);
    expectFaithful(text, payload, personas[0]);
  });

  async function startServer() {
    server = createServer(createApp());
    await new Promise<void>(resolve => {
      server?.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

function expectFaithful(text: string, draft: ResumeIntakeResult, persona: typeof personas[number]) {
  const { resume } = draft;
  const serialized = JSON.stringify(resume);

  expect(resume.personal.fullName).toBe(persona.name);
  expect(resume.personal.headline).toBe(persona.headline);
  expect(resume.personal.email).toBe(persona.email);
  expect(resume.personal.phone).toBe(persona.phone);
  expect(resume.personal.location).toBe(persona.location);
  expect(resume.personal.website || '').not.toBe('email.com');
  expect(resume.personal.linkedin || '').toBe('linkedin' in persona ? persona.linkedin : '');
  expect(resume.personal.github || '').toBe('github' in persona ? persona.github : '');
  expect(resume.personal.website || '').toBe('website' in persona ? persona.website : '');
  expect(resume.summary.startsWith(persona.name)).toBe(false);
  expect(resume.summary).toBe(summaryBlock(text));
  expect(resume.experience.map(entry => entry.company)).toEqual([...persona.companies]);
  expect(resume.education.map(entry => entry.school)).toEqual([...persona.schools]);
  expect(resume.projects.map(project => project.name)).toEqual([...persona.projects]);
  expect(serialized).not.toContain('Detected Skills');

  for (const item of persona.skillItems) expect(serialized).toContain(item);
  for (const snippet of persona.extraText) expect(serialized).toContain(snippet);
  const storedBullets = [
    ...resume.experience.flatMap(entry => entry.bullets),
    ...resume.projects.flatMap(project => project.bullets),
    ...resume.education.flatMap(entry => entry.details || []),
  ];
  const expectedBullets = sourceBullets(text);
  for (const bullet of expectedBullets) {
    expect(storedBullets).toContain(bullet);
  }
  expect(storedBullets.filter(bullet => expectedBullets.includes(bullet))).toHaveLength(expectedBullets.length);

  for (const entry of resume.experience) {
    expect(entry.bullets.length).toBeGreaterThan(0);
    expect(new Set(entry.bullets).size).toBe(entry.bullets.length);
  }

  for (const project of resume.projects) {
    expect(project.name).not.toContain(', ');
    const unique = new Set(project.bullets);
    expect(unique.size).toBe(project.bullets.length);
    for (const bullet of project.bullets) {
      expect(project.description).not.toBe(bullet);
      expect(project.name).not.toContain(bullet);
    }
  }
}

function summaryBlock(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(line => line.trim());
  const headers = new Set(['SUMMARY', 'EXPERIENCE', 'EDUCATION', 'PROJECTS', 'SKILLS', '个人总结', '工作经历', '实习经历', '教育背景', '项目经历', '技能']);
  const start = lines.findIndex(line => headers.has(line) && (line === 'SUMMARY' || line === '个人总结'));
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line) {
      if (body.length > 0) break;
      continue;
    }
    if (headers.has(line)) break;
    body.push(line);
  }
  return body.join(' ');
}

function sourceBullets(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim().match(/^-\s+(.+)$/)?.[1]?.trim() || '')
    .filter(Boolean);
}

function readPersona(dir: string, file: string): string {
  return readFileSync(new URL(`./fixtures/${dir}/${file}`, import.meta.url), 'utf8');
}

async function createResumePdf(text: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const latinFont = await pdfDoc.embedFont(latinFontBytes, { subset: true });
  const cjkFont = await pdfDoc.embedFont(cjkFontBytes, { subset: true });
  const size = 9;
  const maxWidth = 700;
  let page = pdfDoc.addPage([792, 1100]);
  let y = 1060;
  const measure = (value: string) => splitFontRuns(value).reduce((sum, run) => {
    const font = run.font === 'latin' ? latinFont : cjkFont;
    return sum + font.widthOfTextAtSize(run.text, size);
  }, 0);

  for (const sourceLine of text.replace(/\r\n/g, '\n').split('\n')) {
    for (const line of wrapPdfLine(sourceLine, maxWidth, measure)) {
      if (y < 36) {
        page = pdfDoc.addPage([792, 1100]);
        y = 1060;
      }

      let x = 36;
      const runs = splitFontRuns(line);
      if (runs.length === 0) {
        page.drawText(' ', { x, y, size, font: latinFont, color: rgb(0.1, 0.1, 0.12) });
      }
      for (const run of runs) {
        const font = run.font === 'latin' ? latinFont : cjkFont;
        page.drawText(run.text, { x, y, size, font, color: rgb(0.1, 0.1, 0.12) });
        x += font.widthOfTextAtSize(run.text, size);
      }
      y -= 14;
    }
  }

  return Buffer.from(await pdfDoc.save());
}

function wrapPdfLine(line: string, maxWidth: number, measure: (value: string) => number): string[] {
  if (!line || measure(line) <= maxWidth) return [line];
  const words = line.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function splitFontRuns(line: string): Array<{ font: 'latin' | 'cjk'; text: string }> {
  const runs: Array<{ font: 'latin' | 'cjk'; text: string }> = [];
  for (const char of line) {
    const font = usesLatinFont(char) ? 'latin' : 'cjk';
    const current = runs[runs.length - 1];
    if (current?.font === font) current.text += char;
    else runs.push({ font, text: char });
  }
  return runs;
}

function usesLatinFont(char: string): boolean {
  const code = char.codePointAt(0) || 0;
  return code < 128 || (code >= 0x2010 && code <= 0x2027);
}

function resumeSkeleton(overrides: Partial<ResumeData> & Pick<ResumeData, 'personal' | 'summary'>): ResumeData {
  return {
    id: 'mangled',
    title: 'Mangled Resume',
    templateId: 'clean-professional',
    design: {
      typography: 'classic',
      density: 'comfortable',
      pageSize: 'letter',
      accentColor: '#2563eb',
    },
    experience: [],
    education: [],
    skills: [],
    projects: [],
    ...overrides,
  };
}
