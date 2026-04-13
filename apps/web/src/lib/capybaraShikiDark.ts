export const capybaraShikiDark = {
  name: "capybara-dark",
  type: "dark",
  colors: {
    "editor.background": "#241C14",
    "editor.foreground": "#E8DDD0",
    "editor.lineHighlightBackground": "#2E2318",
    "editor.selectionBackground": "#453628",
    "editorLineNumber.foreground": "#7A6B5A",
    "editorLineNumber.activeForeground": "#C4A97D",
  },
  tokenColors: [
    {
      scope: ["keyword", "storage", "storage.type", "keyword.control", "keyword.operator.new"],
      settings: { foreground: "#C4A97D", fontStyle: "bold" },
    },
    {
      scope: ["string", "string.quoted", "string.template"],
      settings: { foreground: "#D4A44C" },
    },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#7A6B5A", fontStyle: "italic" },
    },
    {
      scope: ["entity.name.function", "support.function"],
      settings: { foreground: "#E8C890" },
    },
    {
      scope: ["entity.name.type", "support.type", "support.class"],
      settings: { foreground: "#B8A080" },
    },
    {
      scope: ["variable", "variable.other", "variable.parameter"],
      settings: { foreground: "#E8DDD0" },
    },
    {
      scope: ["constant.numeric", "constant.numeric.decimal"],
      settings: { foreground: "#E8A830" },
    },
    {
      scope: ["constant.language"],
      settings: { foreground: "#C4A97D" },
    },
    {
      scope: ["punctuation", "keyword.operator", "keyword.operator.assignment"],
      settings: { foreground: "#C4A97D" },
    },
    {
      scope: ["entity.name.tag"],
      settings: { foreground: "#E8C890" },
    },
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: "#D4A44C" },
    },
    {
      scope: ["meta.embedded", "source.groovy.embedded"],
      settings: { foreground: "#E8DDD0" },
    },
    {
      scope: ["string.regexp"],
      settings: { foreground: "#E8A830" },
    },
    {
      scope: ["variable.language.this", "variable.language.self"],
      settings: { foreground: "#C4A97D", fontStyle: "italic" },
    },
  ],
};
