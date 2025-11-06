import {
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
  type SpecialLanguage,
  type StringLiteralUnion,
} from 'shiki'
import type { FunctionalComponent } from 'vue'

import IconAngular from '~icons/devicon/angularjs'
import { default as IconBash, default as IconFish } from '~icons/devicon/bash'
import IconC from '~icons/devicon/c'
import IconCpp from '~icons/devicon/cplusplus'
import IconCSharp from '~icons/devicon/csharp'
import IconCss from '~icons/devicon/css3'
import IconDart from '~icons/devicon/dart'
import IconElixir from '~icons/devicon/elixir'
import IconGo from '~icons/devicon/go'
import IconHaskell from '~icons/devicon/haskell'
import IconHtml from '~icons/devicon/html5'
import IconJava from '~icons/devicon/java'
import IconJs from '~icons/devicon/javascript'
import IconJson from '~icons/devicon/json'
import IconKotlin from '~icons/devicon/kotlin'
import IconLua from '~icons/devicon/lua'
import IconMd from '~icons/devicon/markdown'
import IconPhp from '~icons/devicon/php'
import IconPython from '~icons/devicon/python'
import { default as IconJsx, default as IconTsx } from '~icons/devicon/react'
import IconRuby from '~icons/devicon/ruby'
import IconRust from '~icons/devicon/rust'
import IconScala from '~icons/devicon/scala'
import IconSvelte from '~icons/devicon/svelte'
import IconSwift from '~icons/devicon/swift'
import IconTs from '~icons/devicon/typescript'
import IconVim from '~icons/devicon/vim'
import IconVue from '~icons/devicon/vuejs'
import IconYaml from '~icons/devicon/yaml'
import IconZsh from '~icons/devicon/zsh'
import IconText from '~icons/vscode-icons/file-type-text'
import IconLaTex from '~icons/devicon/latex'
import IconSql from '~icons/vscode-icons/file-type-sql'

let _globalHighlighter: Promise<Highlighter> | undefined = undefined

export function getShikiHighlighter() {
  if (_globalHighlighter) {
    return _globalHighlighter
  }

  _globalHighlighter = createHighlighter({
    themes: ['catppuccin-latte', 'catppuccin-macchiato'],
    langs: [
      'js',
      'jsx',
      'json',
      'ts',
      'tsx',
      'vue',
      'css',
      'html',
      'bash',
      'md',
      'yaml',
      'c',
      'cpp',
      'python',
      'go',
      'java',
      'ruby',
      'fish',
      'csharp',
      'zsh',
      'rust',
      'text',
      'angular-ts',
      'angular-html',
      'svelte',
      'vimscript',
      'lua',
      'dart',
      'swift',
      'php',
      'kotlin',
      'elixir',
      'haskell',
      'scala',
      'latex',
      'tex',
      'sql',
    ],
  })

  return _globalHighlighter
}

export type ShikiLanguages = StringLiteralUnion<BundledLanguage> | SpecialLanguage
export const shikiLanguageIcons: Partial<Record<ShikiLanguages, FunctionalComponent>> = {
  js: IconJs,
  javascript: IconJs,
  jsx: IconJsx,
  json: IconJson,
  json5: IconJson,
  jsonc: IconJson,
  ts: IconTs,
  typescript: IconTs,
  tsx: IconTsx,
  vue: IconVue,
  'vue-html': IconVue,
  css: IconCss,
  html: IconHtml,
  bash: IconBash,
  md: IconMd,
  markdown: IconMd,
  yaml: IconYaml,
  yml: IconYaml,
  c: IconC,
  cpp: IconCpp,
  python: IconPython,
  go: IconGo,
  java: IconJava,
  ruby: IconRuby,
  fish: IconFish,
  csharp: IconCSharp,
  zsh: IconZsh,
  rust: IconRust,
  text: IconText,
  txt: IconText,
  ansi: IconText,
  'angular-ts': IconAngular,
  'angular-html': IconAngular,
  svelte: IconSvelte,
  vimscript: IconVim,
  vim: IconVim,
  lua: IconLua,
  dart: IconDart,
  swift: IconSwift,
  php: IconPhp,
  kotlin: IconKotlin,
  elixir: IconElixir,
  haskell: IconHaskell,
  scala: IconScala,
  latex: IconLaTex,
  tex: IconLaTex,
  sql: IconSql,
}
