import { defineConfig } from 'vitepress';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'QASpider',
  description: 'Autonomous Story-Driven Web QA Engine & Studio',
  base: '/qaspider/',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,
  head: [
    ['link', { rel: 'icon', href: '/qaspider/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#6366f1' }]
  ],
  themeConfig: {
    siteTitle: '🕷️ QASpider',
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/guide/getting-started' },
      { text: 'Architecture', link: '/DEVELOPMENT' },
      { text: 'Studio', link: '/STUDIO' },
      { text: 'Engine & MCP', link: '/V3-ENGINE' },
      {
        text: 'v0.0.0-beta',
        items: [
          { text: 'Release Notes', link: '/BETA_RELEASE_NOTES' },
          { text: 'Benchmarks', link: '/BENCHMARKS' },
          { text: 'Contributing', link: 'https://github.com/imavinashsingh/qaspider/blob/master/CONTRIBUTING.md' }
        ]
      }
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Architecture & Development', link: '/DEVELOPMENT' },
          { text: 'Live Demo & Guided Walkthrough', link: '/DEMO' }
        ]
      },
      {
        text: 'Core Features',
        items: [
          { text: 'Story-First Planning', link: '/STORY-FIRST' },
          { text: 'Studio Workflows & UI', link: '/STUDIO' },
          { text: 'Studio UX Principles', link: '/STUDIO-UX' },
          { text: 'V3 Engine & MCP Bridge', link: '/V3-ENGINE' }
        ]
      },
      {
        text: 'Verification & Benchmarks',
        items: [
          { text: 'Benchmarks & Acceptance', link: '/BENCHMARKS' },
          { text: 'Beta Release Notes', link: '/BETA_RELEASE_NOTES' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/imavinashsingh/qaspider' }
    ],

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/imavinashsingh/qaspider/edit/master/docs/:path',
      text: 'Edit this page on GitHub'
    },

    footer: {
      message: 'Released under the Apache 2.0 License.',
      copyright: 'Copyright © 2026 Avinash Singh'
    }
  }
});
