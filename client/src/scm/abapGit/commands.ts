import {
  SourceControlResourceGroup,
  SourceControlResourceState,
  SourceControl
} from "vscode"
import { command, AbapFsCommands } from "../../commands"
import {
  refresh,
  fromSC,
  AgResState,
  isAgResState,
  fromData,
  UNSTAGED,
  STAGED,
  ScmData
} from "./scm"
import {
  log,
  simpleInputBox,
  chainTaskTransformers,
  fieldReplacer
} from "../../lib"
import { map, isNone, none, chain, fromEither } from "fp-ts/lib/Option"
import { getServer } from "../../adt/AdtServer"
import { repoCredentials } from "./credentials"
import { GitStagingFile, GitStaging } from "abap-adt-api"

const transfer = (
  source: SourceControlResourceGroup,
  target: SourceControlResourceGroup,
  items: SourceControlResourceState[]
) => {
  target.resourceStates = [...target.resourceStates, ...items]
  source.resourceStates = source.resourceStates.filter(x => !items.includes(x))
}

const findSC = () => (target: any, propertyKey: string) => {
  target[propertyKey] = (x: SourceControl) =>
    map(target[propertyKey])(fromSC(x))
}

const getCommitDetails = async (data: ScmData) => {
  const cred = await repoCredentials(data, true)
  if (isNone(cred)) return none
  const commitdata = { ...cred.value, name: "", email: "" }
  const getUser = simpleInputBox("Committer user")
  const getEmail = simpleInputBox("Committer email", cred.value.user)
  return fromEither(
    await chainTaskTransformers<typeof commitdata>(
      fieldReplacer("name", getUser),
      fieldReplacer("email", getEmail)
    )(commitdata)()
  )
}

export class GitCommands {
  @command(AbapFsCommands.agitRefresh)
  @findSC()
  private static async refreshCmd(data: ScmData) {
    return refresh(data)
  }
  @command(AbapFsCommands.agitPush)
  @findSC()
  private static async pushCmd(data: ScmData) {
    const details = await getCommitDetails(data)
    if (isNone(details)) return
    const client = getServer(data.connId).client
    const { user, password, name, email } = details.value
    data.staging =
      data.staging || (await client.stageRepo(data.repo, user, password))
    const all = [...data.staging.unstaged, ...data.staging.staged]
    if (!all.length) return
    const toPush: GitStaging = {
      ...data.staging,
      staged: [],
      unstaged: [],
      author: { name, email },
      committer: { name, email },
      comment: data.scm.inputBox.value
    }
    const staged = data.groups.get(STAGED).resourceStates
    const inStaged = (f: GitStagingFile) =>
      !!staged.find(s => s.resourceUri.toString() === `${f.path}${f.name}`)
    // sort objects and files
    for (const obj of all) {
      const sf: GitStagingFile[] = []
      const uf: GitStagingFile[] = []
      for (const f of obj.abapGitFiles)
        if (inStaged(f)) sf.push(f)
        else uf.push(f)
      if (sf) toPush.staged.push({ ...obj, abapGitFiles: sf })
      if (uf) toPush.unstaged.push({ ...obj, abapGitFiles: uf })
    }
    client.pushRepo(data.repo, toPush, user, password)

    log("not yet implemented...")
  }
  @command(AbapFsCommands.agitPullScm)
  @findSC()
  private static async pullCmd(data: ScmData) {
    log("not yet implemented...")
  }

  @command(AbapFsCommands.agitAdd)
  private static async addCmd(
    ...args: AgResState[] | SourceControlResourceGroup[]
  ) {
    const unstaged = args[0]
    if (isAgResState(unstaged)) {
      const data = unstaged.data
      const states = args as AgResState[]
      transfer(data.groups.get(UNSTAGED), data.groups.get(STAGED), states)
    } else {
      const data = fromData(unstaged)
      if (data)
        transfer(unstaged, data.groups.get(STAGED), unstaged.resourceStates)
    }
  }

  @command(AbapFsCommands.agitRemove)
  private static async removeCmd(
    ...args: AgResState[] | SourceControlResourceGroup[]
  ) {
    const staged = args[0]
    if (isAgResState(staged)) {
      const data = staged.data
      const states = args as AgResState[]
      transfer(data.groups.get(STAGED), data.groups.get(UNSTAGED), states)
    } else {
      const data = fromData(staged)
      if (data)
        transfer(staged, data.groups.get(UNSTAGED), staged.resourceStates)
    }
  }

  @command(AbapFsCommands.agitresetPwd)
  private static async resetCmd() {
    log("not yet implemented...")
  }
}
