/**
 * Mermaid Documentation Data
 * Local reference for AI agents - no network required
 */

export interface DiagramTypeInfo {
  name: string;
  description: string;
  keywords: string[];
  syntax: string;
  example: string;
  commonElements: string[];
}

export const MERMAID_DOCUMENTATION: Record<string, DiagramTypeInfo> = {
  flowchart: {
    name: "Flowchart",
    description: "Process flows, decision trees, and workflow diagrams. Use direction: TD (top-down), LR (left-right), TB (top-bottom), RL (right-left).",
    keywords: ["flowchart", "graph", "TD", "LR", "TB", "RL", "-->", "---", "-.->", "==>"],
    syntax: "flowchart TD\\n    Start([Start]) --> Process[Process]\\n    Process --> Decision{Decision?}\\n    Decision -->|Yes| End([End])\\n    Decision -->|No| Process",
    example: `flowchart TD
    A[Christmas] -->|Get money| B(Go shopping)
    B --> C{Let me think}
    C -->|One| D[Laptop]
    C -->|Two| E[iPhone]
    C -->|Three| F[fa:fa-car Car]`,
    commonElements: [
      "Rectangles: [Text]",
      "Rounded rectangles: (Text)",
      "Circles: ((Text))",
      "Diamond (decision): {Text?}",
      "Hexagon: {{Text}}",
      "Parallelogram: [/Text/]",
      "Stadium: ([Text])",
      "Database: [(Text)]"
    ]
  },

  sequence: {
    name: "Sequence Diagram",
    description: "Interaction diagrams showing message flows between participants over time.",
    keywords: ["sequenceDiagram", "participant", "actor", "->>", "-->>", "->", "-->", "activate", "deactivate", "Note"],
    syntax: "sequenceDiagram\\n    participant A as Alice\\n    participant B as Bob\\n    A->>B: Hello Bob\\n    activate B\\n    B-->>A: Hello Alice\\n    deactivate B",
    example: `sequenceDiagram
    Alice->>+John: Hello John, how are you?
    Alice->>+John: John, can you hear me?
    John-->>-Alice: Hi Alice, I can hear you!
    John-->>-Alice: I feel great!`,
    commonElements: [
      "Solid arrow: ->>",
      "Dotted arrow: -->>",
      "Solid line no arrow: ->",
      "Dotted line no arrow: -->",
      "Activate/deactivate: +/-",
      "Note over participant: Note over Alice: Note text",
      "Note left/right: Note left of Alice: Note text"
    ]
  },

  class: {
    name: "Class Diagram",
    description: "Object-oriented class relationships and structure diagrams.",
    keywords: ["classDiagram", "class", "<<interface>>", "<<abstract>>", "<|--", "-->", "*--", "o--", "+", "-", "#", "~"],
    syntax: "classDiagram\\n    class Animal {\\n      +String name\\n      +int age\\n      +makeSound()\\n    }\\n    Animal <|-- Dog\\n    Animal <|-- Cat",
    example: `classDiagram
    Animal <|-- Duck
    Animal <|-- Fish
    Animal <|-- Zebra
    Animal : +int age
    Animal : +String gender
    Animal: +isMammal()
    class Duck{
      +String beakColor
      +swim()
      +quack()
    }`,
    commonElements: [
      "Inheritance: <|--",
      "Composition: *--",
      "Aggregation: o--",
      "Association: -->",
      "Dependency: ..>",
      "Public: +",
      "Private: -",
      "Protected: #",
      "Package/Internal: ~"
    ]
  },

  state: {
    name: "State Diagram",
    description: "State machines showing system states and transitions.",
    keywords: ["stateDiagram-v2", "state", "[*]", "-->", "note"],
    syntax: "stateDiagram-v2\\n    [*] --> Still\\n    Still --> [*]\\n    Still --> Moving\\n    Moving --> Still\\n    Moving --> Crash\\n    Crash --> [*]",
    example: `stateDiagram-v2
    [*] --> Still
    Still --> [*]
    Still --> Moving
    Moving --> Still
    Moving --> Crash
    Crash --> [*]`,
    commonElements: [
      "Start/End state: [*]",
      "State: StateName",
      "Transition: State1 --> State2",
      "Composite state: state CompositeState { [*] --> SubState }",
      "Choice: <<choice>>",
      "Fork: <<fork>>",
      "Join: <<join>>"
    ]
  },

  er: {
    name: "Entity Relationship Diagram",
    description: "Database entity relationships and schema design diagrams.",
    keywords: ["erDiagram", "||--o{", "}o--||", "||--||", "}o--o{", "{}"],
    syntax: "erDiagram\\n    CUSTOMER {\\n        string name\\n        string custNumber\\n    }\\n    ORDER {\\n        int orderNumber\\n        string deliveryAddress\\n    }\\n    CUSTOMER ||--o{ ORDER : places",
    example: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    CUSTOMER }|..|{ DELIVERY-ADDRESS : uses`,
    commonElements: [
      "One to one: ||--||",
      "One to many: ||--o{",
      "Many to one: }o--||",
      "Many to many: }o--o{",
      "Zero or one: ||..o|",
      "Zero or many: }o..|{",
      "Entity attributes: ENTITY { type attribute }"
    ]
  },

  journey: {
    name: "User Journey",
    description: "User experience flows and journey mapping diagrams.",
    keywords: ["journey", "title", "section", ":", "Task", "Actor"],
    syntax: "journey\\n    title My working day\\n    section Go to work\\n      Make tea: 5: Me\\n      Go upstairs: 3: Me\\n      Do work: 1: Me, Cat",
    example: `journey
    title My working day
    section Go to work
      Make tea: 5: Me
      Go upstairs: 3: Me
      Do work: 1: Me, Cat
    section Go home
      Go downstairs: 5: Me
      Sit down: 5: Me`,
    commonElements: [
      "Title: title Journey Title",
      "Section: section Section Name",
      "Task: Task Name: Score: Actor1, Actor2",
      "Score range: 1-5 (1=bad, 5=good)",
      "Multiple actors: Actor1, Actor2",
      "Task format: TaskName: Score: Actors"
    ]
  },

  gantt: {
    name: "Gantt Chart",
    description: "Project timelines, schedules, and task management diagrams.",
    keywords: ["gantt", "title", "dateFormat", "section", ":done", ":active", ":crit", "axisFormat"],
    syntax: "gantt\\n    title Project Timeline\\n    dateFormat YYYY-MM-DD\\n    section Planning\\n    Research: done, res1, 2024-01-01, 2024-01-05\\n    Design: active, des1, 2024-01-03, 3d",
    example: `gantt
    title A Gantt Diagram
    dateFormat  YYYY-MM-DD
    section Section
    A task           :a1, 2014-01-01, 30d
    Another task     :after a1, 20d
    section Another
    Task in sec      :2014-01-12, 12d
    another task     :24d`,
    commonElements: [
      "Date format: dateFormat YYYY-MM-DD",
      "Task states: :done, :active, :crit",
      "Task syntax: TaskName: id, start-date, duration",
      "Dependencies: :after taskId",
      "Duration: 30d, 3w, 2m",
      "Sections: section SectionName",
      "Axis format: axisFormat %m/%d"
    ]
  },

  pie: {
    name: "Pie Chart",
    description: "Data visualization with proportional pie chart segments.",
    keywords: ["pie", "title", "showData", "%%"],
    syntax: "pie title Pie Chart\\n    \\\"Dogs\\\" : 386\\n    \\\"Cats\\\" : 85\\n    \\\"Rats\\\" : 15",
    example: `pie title Pets adopted by volunteers
    "Dogs" : 386
    "Cats" : 85
    "Rats" : 15`,
    commonElements: [
      "Title: pie title Chart Title",
      "Data: \"Label\" : value",
      "Show data: pie showData",
      "Comments: %% Comment text",
      "Multiple datasets supported",
      "Percentage auto-calculated"
    ]
  },

  gitgraph: {
    name: "Git Graph",
    description: "Version control branching and merging visualizations.",
    keywords: ["gitgraph", "commit", "branch", "checkout", "merge", "cherry-pick"],
    syntax: "gitgraph\\n    commit\\n    branch develop\\n    checkout develop\\n    commit\\n    checkout main\\n    merge develop",
    example: `gitgraph
    commit
    commit
    branch develop
    checkout develop
    commit
    commit
    checkout main
    merge develop`,
    commonElements: [
      "Basic commit: commit",
      "Commit with message: commit id: \"Message\"",
      "Create branch: branch branchName",
      "Switch branch: checkout branchName",
      "Merge branch: merge branchName",
      "Cherry pick: cherry-pick id: \"commit-id\"",
      "Commit types: NORMAL, REVERSE, HIGHLIGHT"
    ]
  }
};

export const GENERAL_MERMAID_INFO = {
  themes: ["default", "dark", "forest", "neutral"],
  commonDirectives: [
    "%%{init: {'theme':'dark'}}%%",
    "%%{wrap}%%",
    "%%{config: {'fontFamily': 'Arial'}}%%"
  ],
  tips: [
    "Use quotes around text with spaces or special characters",
    "Comments start with %%",
    "Themes can be set with %%{init: {'theme':'themeName'}}%%",
    "Direction in flowcharts: TD (top-down), LR (left-right), TB, RL",
    "Escape special characters with backslash in text",
    "Use meaningful IDs for elements to reference them later"
  ],
  troubleshooting: [
    "Syntax errors: Check for missing quotes, colons, or brackets",
    "Rendering issues: Verify diagram type declaration is correct",
    "Connection problems: Ensure node IDs match exactly",
    "Text display: Use quotes for text with spaces or special chars"
  ]
};

export function getDocumentationForType(diagramType: string, includeExamples: boolean = true): string {
  if (diagramType === 'all') {
    return getAllDocumentation(includeExamples);
  }

  const info = MERMAID_DOCUMENTATION[diagramType];
  if (!info) {
    return `Unknown diagram type: ${diagramType}. Available types: ${Object.keys(MERMAID_DOCUMENTATION).join(', ')}`;
  }

  let doc = `# ${info.name} Documentation\n\n`;
  doc += `**Description:** ${info.description}\n\n`;
  doc += `**Keywords:** ${info.keywords.join(', ')}\n\n`;
  doc += `**Basic Syntax:**\n\`\`\`\n${info.syntax}\n\`\`\`\n\n`;
  
  if (includeExamples) {
    doc += `**Example:**\n\`\`\`mermaid\n${info.example}\n\`\`\`\n\n`;
  }
  
  doc += `**Common Elements:**\n`;
  info.commonElements.forEach(element => {
    doc += `- ${element}\n`;
  });

  return doc;
}

function getAllDocumentation(includeExamples: boolean): string {
  let doc = `# Complete Mermaid Documentation\n\n`;
  
  doc += `## Available Diagram Types\n`;
  Object.entries(MERMAID_DOCUMENTATION).forEach(([type, info]) => {
    doc += `- **${type}**: ${info.description}\n`;
  });
  
  doc += `\n## General Information\n`;
  doc += `**Available Themes:** ${GENERAL_MERMAID_INFO.themes.join(', ')}\n\n`;
  
  doc += `**Common Directives:**\n`;
  GENERAL_MERMAID_INFO.commonDirectives.forEach(directive => {
    doc += `- \`${directive}\`\n`;
  });
  
  doc += `\n**Tips:**\n`;
  GENERAL_MERMAID_INFO.tips.forEach(tip => {
    doc += `- ${tip}\n`;
  });
  
  doc += `\n**Troubleshooting:**\n`;
  GENERAL_MERMAID_INFO.troubleshooting.forEach(issue => {
    doc += `- ${issue}\n`;
  });

  if (includeExamples) {
    doc += `\n## Detailed Documentation by Type\n\n`;
    Object.entries(MERMAID_DOCUMENTATION).forEach(([type, info]) => {
      doc += getDocumentationForType(type, true) + '\n---\n\n';
    });
  }

  return doc;
}
