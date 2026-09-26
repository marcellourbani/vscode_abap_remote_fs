import {
  DEFAULT_ENABLED_SKILLS,
  GENERAL_SKILL_REGISTRY,
  getSkillSettings,
  skillContextKey
} from "./skillRegistry"

const get = jest.fn().mockReturnValue({})

jest.mock(
  "vscode",
  () => ({
    workspace: {
      getConfiguration: jest.fn(() => ({ get }))
    },
    commands: {
      executeCommand: jest.fn()
    }
  }),
  { virtual: true }
)

describe("GENERAL_SKILL_REGISTRY", () => {
  test("contains only general skills with unique IDs and packaged paths", () => {
    expect(GENERAL_SKILL_REGISTRY.length).toBe(11)
    expect(new Set(GENERAL_SKILL_REGISTRY.map(skill => skill.id)).size).toBe(
      GENERAL_SKILL_REGISTRY.length
    )
    for (const skill of GENERAL_SKILL_REGISTRY) {
      expect(skill.displayName).toBeTruthy()
      expect(skill.description).toBeTruthy()
      expect(skill.path).toMatch(/^skills\/.+\/SKILL\.md$/)
    }
  })

  test("uses default-on settings for skills without an explicit value", () => {
    expect(getSkillSettings().enabledSkills).toEqual(DEFAULT_ENABLED_SKILLS)
    expect(Object.values(DEFAULT_ENABLED_SKILLS).every(Boolean)).toBe(true)
    expect(skillContextKey("clean-abap")).toBe("abapfs:skill.clean-abap.enabled")
  })
})
