import { Uri, tests, TestRunProfileKind, TestRunRequest, TestController, TestItem, TestMessage, MarkdownString, commands, TestItemCollection, TestRun, Range } from "vscode"
import { getClient, getRoot, uriRoot } from "../conections"
import { IncludeService } from "../includes"
import { isAbapFile, isAbapStat, isFolder } from "abapfs"
import { UnitTestAlert, UnitTestAlertKind, UnitTestClass, UnitTestMethod, uriPartsToString } from "abap-adt-api"
import { lineRange } from "../../lib"
import { AbapObject, isAbapClassInclude } from "abapobject"
import { AdtObjectFinder } from "./AdtObjectFinder"

type UnitTarget = UnitTestClass | UnitTestMethod
type UtMethod = {
    uri: string
    type: string
    name: string
    executionTime: number
    unit: string
    alerts: UnitTestAlert[]
    srcUrl: Uri
    range?: Range
}
type UtClass = {
    uri: string
    type: string
    name: string
    testmethods: UtMethod[]
    alerts: UnitTestAlert[],
    srcUrl: Uri
    range?: Range
}
enum TestResType {
    object,
    class,
    method
}

const objectKey = (object: AbapObject) => object.path
const unitUri = (o: UnitTarget) => o.navigationUri || o["adtcore:uri"]
const cleanUT = (o: UnitTarget) => ({
    uri: unitUri(o),
    type: o["adtcore:type"],
    name: o["adtcore:name"],
    alerts: o.alerts
})

const getObject = async (uri: Uri) => {
    const incl = IncludeService.get(uri.authority).current(uri.path)
    if (incl) {
        const mo = await getRoot(uri.authority).findByAdtUri(incl["adtcore:uri"], true)
        const file = mo?.file
        if (isAbapFile(file)) return file.object
    }
    const nodepath = uriRoot(uri).getNodePath(uri.path)
    const last = nodepath[0]
    if (!last || !isAbapStat(last?.file)) throw new Error("Failed to retrieve object for test path")
    const obj = last.file.object

    if (isAbapClassInclude(obj)) {
        if (obj.path.match(/main$/)) return obj
        const prev = nodepath[1]
        if (isFolder(prev?.file))
            return [...prev!.file]
                .map(x => x.file)
                .filter(isAbapStat)
                .find(x => x.object.path.match(/main$/))?.object || obj
    }

    return obj
}

const sourceLocation = async (connId: string, objectUri: string) => {
    const finder = new AdtObjectFinder(connId)
    const { uri, start } = await finder.vscodeRange(objectUri)
    if (start) return { uri, line: start.line }
    return { uri }
}

const runonTestTree = (root: Readonly<TestItem[]>, cb: (i: TestItem) => unknown) => {
    for (const i of root) {
        cb(i)
        runonTestTree([...i.children].map(c => c[1]), cb)
    }
}

const getOrCreateSubItem = (c: TestController, parent: TestItem, m: UtMethod | UtClass) =>
    parent.children.get(m.uri) || c.createTestItem(m.uri, m.name, m.srcUrl)


const removeObsolete = (parent: TestItem, ids: Set<string>) =>
    [...parent.children]
        .filter(c => !ids.has(c[0]))
        .forEach(i => parent.children.delete(i[0]))

const setMethodResult = (run: TestRun, meth: UtMethod, item: TestItem) => {
    const outcome = methodOutcome(meth)
    item.range = meth.range
    if (outcome.passed)
        run.passed(item, meth.executionTime * 1000)
    else
        run.failed(item, outcome.messages, meth.executionTime * 1000)
}

const setClassResult = (run: TestRun, c: UtClass, parent: TestItem, ctrl: TestController) => {
    const nci = getOrCreateSubItem(ctrl, parent, c)
    const outcome = classOutcome(c)
    parent.children.add(nci)
    nci.range = c.range
    const mids = new Set(c.testmethods.map(m => m.uri))
    removeObsolete(nci, mids)
    if (!outcome.passed) run.failed(nci, outcome.messages)

    c.testmethods.forEach(m => {
        const item = getOrCreateSubItem(ctrl, nci, m)
        nci.children.add(item)
        setMethodResult(run, m, item)
    })
    return nci
}

const setObjectResult = (run: TestRun, classes: UtClass[], parent: TestItem, ctrl: TestController) => {
    const ids = new Set(classes.map(c => c.uri))
    for (const c of classes)
        setClassResult(run, c, parent, ctrl)
    removeObsolete(parent, ids)
}


const runUnitUrl = async (connId: string, path: string): Promise<UtClass[]> => {
    const uriMaps = new Map<string, { srcUrl: Uri, range?: Range }>
    const client = getClient(connId)
    const rawClasses = await client.unitTestRun(path)
    for (const c of rawClasses) {
        const source = await client.getObjectSource(unitUri(c))
        const processUri = async (o: UnitTarget) => {
            const ouri = unitUri(o)
            const marker = await client.unitTestOccurrenceMarkers(ouri, source)
            const adturi = marker[1] ? uriPartsToString(marker[1].location) : ouri
            const l = await sourceLocation(connId, adturi)
            const range = l.line || l.line === 0 ? lineRange(l.line + 1) : undefined
            uriMaps.set(ouri, { srcUrl: Uri.parse(l.uri), range })
        }
        await processUri(c)
        for (const m of c.testmethods) await processUri(m)
    }
    const mm = (m: UnitTestMethod): UtMethod => {
        const { srcUrl, range } = uriMaps.get(unitUri(m))!
        return { ...cleanUT(m), unit: m.unit, executionTime: m.executionTime, srcUrl, range }
    }
    const mc = (c: UnitTestClass): UtClass => {
        const { srcUrl, range } = uriMaps.get(unitUri(c))!
        return { ...cleanUT(c), srcUrl, range, testmethods: c.testmethods.map(mm) }
    }
    const classes = rawClasses.map(mc)
    return classes
}

const convertAlert = (alert: UnitTestAlert): TestMessage => new TestMessage(new MarkdownString(`${alert.title}<br>${alert.details.join("<br>")}`, true))
const classOutcome = (item: UtClass) => {
    const missMethods = item.testmethods.length === 0
    const errors = item.alerts.filter(a => a.kind !== UnitTestAlertKind.warning)
    const passed = errors.length === 0 && !missMethods
    return ({ messages: item.alerts.map(convertAlert), passed })
}
const methodOutcome = (item: UtMethod | UtClass) => {
    const passed = !item.alerts.filter(a => a.kind !== UnitTestAlertKind.warning).length
    return ({ messages: item.alerts.map(convertAlert), passed })
}

const setResults = (run: TestRun, classes: UtClass[], item: TestItem, ctrl: TestController, resType: TestResType) => {
    switch (resType) {
        case TestResType.class:
            if (classes.length === 1)
                return setClassResult(run, classes[0]!, item, ctrl)
        case TestResType.method:
            if (classes.length === 1 && classes[0]!.testmethods.length === 1) {
                const m = classes[0]!.testmethods[0]
                return m && setMethodResult(run, m, item)
            }
        case TestResType.object:
            let obj = item
            while (obj.parent) obj = obj.parent
            return setObjectResult(run, classes, obj, ctrl)
    }
}


const runHandler = (runner: UnitTestRunner) => async (request: TestRunRequest) => {
    const included = request.include || [...runner.controller.items].map(x => x[1])
    const connId = included[0]?.uri?.authority
    if (!connId) {
        throw new Error("No valid test found in request")
    }
    const run = runner.controller.createTestRun(request, undefined, false)
    const excluded = (i: TestItem) => request.exclude?.find(ii => i === ii)
    try {
        runonTestTree(included, t => run.enqueued(t))
        runonTestTree(included.filter(x => !excluded(x)), t => run.started(t))
        runonTestTree(included.filter(excluded), t => run.skipped(t))
        for (const i of included) {
            if (excluded(i)) continue
            const classes = await runUnitUrl(connId, i.id)
            runner.setUrlTypes(classes)
            const obj = (i: TestItem): TestItem => runner.getUrlType(i.id) === TestResType.object || !i.parent ? i : obj(i.parent)
            const resType = runner.getUrlType(i.id)
            const actualResType = resType === TestResType.method && (classes.length > 1 || classes[0] && classes[0].testmethods.length > 1) ? TestResType.object : resType
            setResults(run, classes, obj(i), runner.controller, actualResType)
        }
    } finally {
        run.end()
    }
}

export class UnitTestRunner {
    private static instances = new Map<string, UnitTestRunner>()
    private urlTypes = new Map<string, TestResType>()
    readonly controller
    getUrlType(id: string): TestResType {
        return this.urlTypes.get(id) || TestResType.object
    }
    static get(connId: string) {
        const old = this.instances.get(connId)
        if (old) return old
        const instance = new UnitTestRunner(connId)
        this.instances.set(connId, instance)
        return instance
    }


    private constructor(readonly connId: string) {
        this.controller = tests.createTestController(`ABAP${connId}`, `ABAP ${connId}`)
        this.controller.createRunProfile(`ABAP ${connId}`, TestRunProfileKind.Run, runHandler(this), true)
    }

    setUrlTypes(classes: UtClass[]) {
        for (const c of classes) {
            this.urlTypes.set(c.uri, TestResType.class)
            for (const m of c.testmethods)
                this.urlTypes.set(m.uri, TestResType.method)
        }
    }

    async addResults(uri: Uri) {
        commands.executeCommand("workbench.view.testing.focus")
        const object = await getObject(uri)
        const current = this.controller.items.get(objectKey(object)) || this.controller.createTestItem(objectKey(object), object.key, uri)
        this.controller.items.add(current)
        this.urlTypes.set(objectKey(object), TestResType.object)
        await runHandler(this)(new TestRunRequest([current]))
    }
}


