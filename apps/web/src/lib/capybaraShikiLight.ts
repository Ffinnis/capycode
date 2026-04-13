import type { ThemeRegistration } from "shiki";

export const capybaraShikiLight: ThemeRegistration = {
  name: "capybara-light",
  type: "light",
  colors: {
    "editor.background": "#F0E8DC",
    "editor.foreground": "#3D2B1F",
    "editor.lineHighlightBackground": "#EDE3D5",
    "editor.selectionBackground": "#D4C4AE",
    "editorLineNumber.foreground": "#9C8B7A",
    "editorLineNumber.activeForeground": "#6B4C2A",
  },
  tokenColors: [
    {
      scope: ["keyword", "storage", "storage.type", "keyword.control", "keyword.operator.new"],
      settings: { foreground: "#8B6914", fontStyle: "bold" },
    },
    {
      scope: ["string", "string.quoted", "string.template"],
      settings: { foreground: "#A0522D" },
    },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#9C8B7A", fontStyle: "italic" },
    },
    {
      scope: ["entity.name.function", "support.function"],
      settings: { foreground: "#7A6240" },
    },
    {
      scope: ["entity.name.type", "support.type", "support.class"],
      settings: { foreground: "#6B4C2A" },
    },
    {
      scope: ["variable", "variable.other", "variable.parameter"],
      settings: { foreground: "#3D2B1F" },
    },
    {
      scope: ["constant.numeric", "constant.numeric.decimal"],
      settings: { foreground: "#B8860B" },
    },
    {
      scope: ["constant.language"],
      settings: { foreground: "#8B6914" },
    },
    {
      scope: ["punctuation", "keyword.operator", "keyword.operator.assignment"],
      settings: { foreground: "#6B4C2A" },
    },
    {
      scope: ["entity.name.tag"],
      settings: { foreground: "#7A6240" },
    },
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: "#A0522D" },
    },
    {
      scope: ["meta.embedded", "source.groovy.embedded"],
      settings: { foreground: "#3D2B1F" },
    },
    {
      scope: ["string.regexp"],
      settings: { foreground: "#B8860B" },
    },
    {
      scope: ["variable.language.this", "variable.language.self"],
      settings: { foreground: "#8B6914", fontStyle: "italic" },
    },
  ],
};
