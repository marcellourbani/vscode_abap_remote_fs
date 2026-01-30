import {
  SourceControlResourceGroup,
  SourceControlResourceState,
  SourceControl,
  Memento,
  window,
  commands,
  QuickPickItem,
  Uri,
  SourceControlResourceDecorations
} from "vscode"
import { command, AbapFsCommands } from "../../commands"
import {
  refresh,
  fromSC,
  AgResState,
  isAgResState,
  fromGroup,
  UNSTAGED,
  STAGED,
  ScmData,
  fileUri,
  IGNORED,
  AgResGroup,
  scmData,
  scmKey
} from "./scm"
import {
  after,
  simpleInputBox,
  chainTaskTransformers,
  fieldReplacer,
  withp,
  createTaskTransformer,
  createStore,
  inputBox,
  quickPick,
  caughtToString,
  askConfirmation
} from "../../lib"
import { map, isNone, none, fromEither, isSome } from "fp-ts/lib/Option"
import { dataCredentials, listPasswords, deletePassword, deleteDefaultUser } from "./credentials"
import { GitStagingFile, GitStaging } from "abap-adt-api"
import { context } from "../../extension"
import { selectTransport } from "../../adt/AdtTransports"
import { pickAdtRoot } from "../../config"
import { isRight, isLeft } from "fp-ts/lib/Either"
import { confirmPull, packageUri } from "../../views/abapgit"
import { getClient, uriRoot } from "../../adt/conections"

let commitStore: Memento
const getStore = () => {
  if (!commitStore)
    commitStore = createStore("abapGitRepoCommit", context.globalState)
  return commitStore
}

let decorations: SourceControlResourceDecorations
const statesEquals = (
  x: SourceControlResourceState,
  y: SourceControlResourceState
) => y.resourceUri.toString() === x.resourceUri.toString()
const hasState = (
  group: SourceControlResourceGroup,
  state: SourceControlResourceState
) => !!group.resourceStates.find(x => statesEquals(x, state))
const transfer = (
  source: SourceControlResourceGroup,
  target: SourceControlResourceGroup,
  items: SourceControlResourceState[]
) => {
  if (!decorations)
    decorations = {
      tooltip: "Resource modified on remote",
      faded: true,
      iconPath: Uri.file(context.asAbsolutePath("client/images/warning.svg"))
    }
  target.resourceStates = [
    ...target.resourceStates,
    ...items.map(i => {
      if (target.id !== STAGED) return { ...i, decorations: {} }
      if (source.id === IGNORED) return { ...i, decorations }
      return i
    })
  ]
  source.resourceStates = source.resourceStates.filter(
    x => !items.find(y => statesEquals(x, y))
  )
}
const validateInput = (x: string) => (x ? null : "Field is mandatory")
const getCommitDetails = async (data: ScmData) => {
  const cred = await dataCredentials(data, true)
  if (isNone(cred)) return none
  const repoid = `${data.connId}_${data.repo.sapPackage}`
  const { committer = "", committerEmail = cred.value.user } =
    getStore().get<{ committer: string, committerEmail: string }>(repoid) || {}
  const comment = data.scm.inputBox.value
  const commitdata = { ...cred.value, name: "", email: "", comment }
  const getUser = inputBox({
    prompt: "Committer user",
    value: committer,
    validateInput
  })
  const getEmail = simpleInputBox("Committer email", committerEmail)
  const getComment = inputBox({ prompt: "Commit comment", validateInput })

  return fromEither(
    await chainTaskTransformers<typeof commitdata>(
      fieldReplacer("comment", getComment, x => !x.comment),
      fieldReplacer("name", getUser),
      fieldReplacer("email", getEmail),
      createTaskTransformer(c => {
        if (!(c.comment && c.email && c.name)) return none // will be ignored
        getStore().update(repoid, {
          committer: c.name,
          committerEmail: c.email
        })
        return c
      })
    )(commitdata)()
  )
}

const toCommit = (data: ScmData) => {
  if (!data.staging || !data.groups.get(STAGED).resourceStates.length) return

  const all =
    (data.staging && [...data.staging.unstaged, ...data.staging.staged]) || []
  const toPush: GitStaging = {
    ...data.staging,
    staged: [],
    unstaged: []
  }

  const staged = data.groups.get(STAGED).resourceStates
  const inStaged = (f: GitStagingFile) => {
    const target = fileUri(f).toString()
    return !!staged.find(s => s.resourceUri.toString() === target)
  }
  // sort objects and files
  for (const obj of all) {
    const sf: GitStagingFile[] = []
    const uf: GitStagingFile[] = []
    for (const f of obj.abapGitFiles)
      if (inStaged(f)) sf.push(f)
      else uf.push(f)
    if (sf.length) toPush.staged.push({ ...obj, abapGitFiles: sf })
    if (uf.length) toPush.unstaged.push({ ...obj, abapGitFiles: uf })
  }

  return toPush
}
const findSC = () => (target: any, propertyKey: string) => {
  const original = target[propertyKey]
  target[propertyKey] = (x: SourceControl) => {
    const y = map(original)(fromSC(x))
    if (isSome(y)) return y.value
  }
}

const logErrors = (meth = "") => (target: any, propertyKey: string) => {
  const original = target[propertyKey]
  target[propertyKey] = async (...args: any[]) => {
    try {
      return await original(...args)
    } catch (error) {
      const message = `${caughtToString(error)} in ${meth || propertyKey}`
      window.showErrorMessage(message)
    }
  }
}

export class GitCommands {
  @command(AbapFsCommands.agitRefresh)
  @logErrors(AbapFsCommands.agitRefresh)
  @findSC()
  private static async refreshCmd(data: ScmData) {
    return await withp(`Refreshing ${data.repo.sapPackage}`, () =>
      refresh(data)
    )
  }
  @command(AbapFsCommands.agitPush)
  @logErrors(AbapFsCommands.agitPush)
  @findSC()
  private static async pushCmd(data: ScmData) {
    const toPush = toCommit(data)
    if (!toPush) return
    const details = await getCommitDetails(data)
    if (isNone(details)) return
    const { user, password, name, email, comment } = details.value
    toPush.author = { name, email }
    toPush.committer = { name, email }
    toPush.comment = comment
    const client = getClient(data.connId)
    try {
      await withp("Committing...", async () => {
        await client.pushRepo(data.repo, toPush, user, password)
      })
      window.showInformationMessage(
        "Commit started successfully. A refresh will be attempted in a few seconds",
        "Ok"
      )
      // errors will be ignored
      withp("Waiting commit", () => after(7000)).then(() =>
        GitCommands.refreshCmd(data)
      )
    } catch (error) {
      throw new Error(`Error during commit:${caughtToString(error)}`)
    }
  }
  @command(AbapFsCommands.agitPullScm)
  @logErrors(AbapFsCommands.agitPullScm)
  @findSC()
  private static async pullCmd(data: ScmData) {
    if (await confirmPull(data.repo.sapPackage))
      return withp("Pulling repo", async () => {
        const client = await getClient(data.connId)
        await dataCredentials(data)
        const uri = await packageUri(client, data.repo.sapPackage)
        const transport = await selectTransport(
          uri,
          data.repo.sapPackage,
          client
        )
        if (transport.cancelled) return
        const result = await client.gitPullRepo(
          data.repo.key,
          data.repo.branch_name,
          transport.transport,
          data.credentials?.user,
          data.credentials?.password
        )
        commands.executeCommand("workbench.files.action.refreshFilesExplorer")
        return result
      })
  }

  @command(AbapFsCommands.agitAdd)
  @logErrors(AbapFsCommands.agitAdd)
  private static async addCmd(
    ...args: AgResState[] | SourceControlResourceGroup[]
  ) {
    const unstaged = args[0]
    if (isAgResState(unstaged)) {
      const data = unstaged.data
      const states = args as AgResState[]
      const source = data.groups.get(unstaged.originalGroupId)
      transfer(source, data.groups.get(STAGED), states)
    } else if (unstaged) {
      const data = fromGroup(unstaged)
      if (data)
        transfer(unstaged, data.groups.get(STAGED), unstaged.resourceStates)
    }
  }

  @command(AbapFsCommands.agitRemove)
  @logErrors(AbapFsCommands.agitRemove)
  private static async removeCmd(...args: AgResState[] | AgResGroup[]) {
    const findTarget = (s: AgResState) => {
      const unstGroup = s.data.groups.get(UNSTAGED)
      return hasState(unstGroup, s) ? unstGroup : s.data.groups.get(IGNORED)
    }
    const staged = args[0]
    if (isAgResState(staged)) {
      const data = staged.data
      const states = args as AgResState[]
      const target = data.groups.get(staged.originalGroupId)
      transfer(data.groups.get(STAGED), target, states)
    } else if (staged) {
      const data = fromGroup(staged)
      if (data) {
        const toUnStaged = staged.resourceStates.filter(
          s => s.originalGroupId === UNSTAGED
        )
        const toIgnored = staged.resourceStates.filter(
          s => s.originalGroupId === IGNORED
        )
        if (toUnStaged.length)
          transfer(staged, data.groups.get(UNSTAGED), toUnStaged)
        if (toIgnored.length)
          transfer(staged, data.groups.get(IGNORED), toIgnored)
      }
    }
  }

  @command(AbapFsCommands.agitresetPwd)
  @logErrors(AbapFsCommands.agitresetPwd)
  private static async resetCmd() {
    const fsRoot = await pickAdtRoot()
    const client = fsRoot && getClient(fsRoot.uri.authority)
    const repos = client && (await client.gitRepos())
    if (!fsRoot || !repos?.length) return

    const items = repos.map(repo => ({
      repo,
      label: repo.sapPackage,
      description: repo.url
    }))

    const item = await quickPick(items, { placeHolder: "Select Repository" })()
    if (isLeft(item)) return
    const candidates = await listPasswords(item.right.repo)
    const user = await quickPick(
      candidates.map(c => c.account),
      { placeHolder: "Select Account" }
    )()
    if (isRight(user)) {
      await deletePassword(item.right.repo, user.right)
      const deluser = await askConfirmation("Delete user too?")()
      const credentials = scmData(scmKey(fsRoot?.uri.authority, item.right.repo.key))?.credentials
      if (credentials && credentials.user === user.right) {
        credentials.password = ""
        if (isRight(deluser) && deluser.right) {
          credentials.user = ""
          deleteDefaultUser(item.right.repo.url)
        }
      }
    }
  }
  @command(AbapFsCommands.agitBranch)
  @logErrors(AbapFsCommands.agitBranch)
  private async switchBranch(data: ScmData) {
    const { password = "", user = "" } = data.credentials || {}
    const client = getClient(data.connId)
    const branch = await client.gitExternalRepoInfo(
      data.repo.url,
      user,
      password
    )
    const candidates = branch.branches.map(b => {
      const o: QuickPickItem = {
        label: b.display_name,
        detail: b.is_head ? "HEAD" : "",
        description: b.name
      }
      return o
    })
    candidates.push({ label: "Create new..." })
    const selection = await quickPick(candidates)()
    if (isLeft(selection)) return
    const sel = selection.right
    if (sel.description)
      await client.switchRepoBranch(
        data.repo,
        sel.description,
        false,
        user,
        password
      )
    else {
      const branchName = await inputBox({
        prompt: "Branch name",
        validateInput
      })()
      if (isLeft(branchName)) return
      if (
        isNone(await dataCredentials(data, true)) ||
        !data.credentials?.password ||
        !data.credentials.user
      )
        return
      await client.switchRepoBranch(
        data.repo,
        `refs/heads/${branchName.right.replace(/ /g, "_")}`,
        true,
        data.credentials.user,
        data.credentials.password
      )
    }
    return GitCommands.refreshCmd(data)
  }
}
