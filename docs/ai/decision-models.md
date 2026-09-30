# Decision Models: Jev and Laya

A decision model does not write an explanation or generate code. It answers a structured
question about text with probabilities that software can use directly.

ABAP FS supports two of them, and they speak the same protocol:

- **Jev**, a hosted service from TypeSafe AI.
- **Laya**, an open-source model you run yourself.

Both are optional, and no ABAP FS workflow calls either one automatically. Each provides a
playground where you can try it with your own text, files, and ABAP objects while
ABAP-specific uses are being developed.

## Choose an engine

| | Jev | Laya |
| --- | --- | --- |
| Setup | An API key | Install and keep a local server running |
| Where your text goes | To TypeSafe | Nowhere; it stays on your machine |
| Cost | Billed by TypeSafe per request | Free |
| Speed | Fast | A second or more per question without a GPU |
| Answer quality | Stronger, including questions with many options | Weaker out of the box |

If you only want to try the idea, Jev takes minutes and gives better answers. If your
organization will not allow SAP source code to leave the network, Laya is the option that
can work at all.

Configuring both is supported. Each gets its own command and its own panel, so you can keep
both open and compare answers on the same state.

!!! tip "Not sure yet?"
    Run **ABAP FS: About Jev and Laya** from the Command Palette. It summarizes both, shows
    which are configured, and gives the exact commands to enable each. It is always
    available, even when neither engine is configured.

## Set up Jev

You need your own TypeSafe API key, in the `TYPESAFE_API_KEY` environment variable.

=== "PowerShell"

    ```powershell
    $env:TYPESAFE_API_KEY = "your-key"
    ```

=== "macOS or Linux"

    ```bash
    export TYPESAFE_API_KEY="your-key"
    ```

Set `TYPESAFE_BASE_URL` as well if TypeSafe has given you a different endpoint. It is
optional and the hosted API is used when it is unset.

!!! warning "Data is sent to TypeSafe"
    The state, question, options or criteria, selected model, and attachment contents are
    sent to TypeSafe when you select **Ask Jev**. Do not submit SAP source code or other
    private data unless your organization permits sending it to TypeSafe.

## Set up Laya

Laya runs as a local HTTP server that speaks the same protocol as Jev. ABAP FS only talks to
it; installing and running it is yours to manage.

Install it and start the server:

```bash
pip install "laya[serve]"
laya-serve
```

The first start downloads model weights, so allow a few minutes.

!!! warning "The server binds every interface by default"
    `laya-serve` listens on port 8000 and, unless you tell it otherwise, binds `0.0.0.0`,
    which reaches it from anywhere that can route to your machine. Set `LAYA_HOST` to
    `127.0.0.1` before starting it if only VS Code on the same machine needs it.

Then point ABAP FS at it:

=== "PowerShell"

    ```powershell
    $env:LAYA_BASE_URL = "http://127.0.0.1:8000"
    ```

=== "macOS or Linux"

    ```bash
    export LAYA_BASE_URL="http://127.0.0.1:8000"
    ```

If you protect the server with a bearer token, set `LAYA_API_KEY` to the same value.
Otherwise leave it unset.

`LAYA_BASE_URL` is deliberately separate from `TYPESAFE_BASE_URL`, so pointing one engine
somewhere else never redirects the other.

!!! info "Laya is weaker out of the box"
    Its authors describe it as a base to fine-tune rather than something to trust
    unmodified. Expect noticeably worse answers on yes-or-no questions and on questions with
    more than about twenty options. Describing your options and criteria carefully matters
    more here than it does with Jev.

## Restart VS Code

Environment variables are read when VS Code starts. After setting one, close every VS Code
window and start it again from the configured environment, or the command will stay hidden.
The variable names are case-sensitive on macOS and Linux.

## Open a playground

Open the Command Palette (`Ctrl+Shift+P`) and run one of:

**ABAP FS: Ask Jev**

**ABAP FS: Ask Laya**

Each command appears only when its engine is configured. Neither playground requires a SAP
connection unless you want to attach an ABAP object.

## Ask a question

1. Enter the **State** the model should evaluate. Any text is accepted, including JSON text.
2. Choose a **Question type**.
3. Write one focused **Question** about the state.
4. Define the available options or criteria.
5. Optionally set a model, change the timeout, or set a token budget.
6. Select **Ask Jev** or **Ask Laya**.

Leave **Model** empty to accept the default. Jev then uses TypeSafe's current `jev-latest`
model. Laya routes to a checkpoint based on the language it detects, which you can override
by naming `english`, `multilingual`, or `typed-decisions`.

### Token budget (Laya only)

Laya reads only as much of the state as its token budget allows and silently drops the
rest, so the panel offers a **Token budget** field.

Leave it empty to accept the checkpoint default, which is the fastest option and enough for
a short state. Raise it, up to 8192, when the answer reports that the state was truncated.
A larger budget reads more of a long state and takes longer.

Jev sizes its own context and has no equivalent field.

## Choose the right question type

### Choice

Use Choice when the model should select one option from a defined set.

For example, given an ABAP object description, you could ask which category fits best and
provide `business`, `technical`, and `generated` as options. Option descriptions are
optional but useful when a short label is ambiguous.

The result shows:

- The option that was chosen
- The confidence in that choice
- The probability assigned to every option

Confidence and the selected option's probability are related but not identical. Confidence
summarizes how strongly the complete distribution favors one option.

### Noul

Use Noul for a yes-or-no judgment.

For example: _"Do these two classes behave differently?"_

The model returns the probability that the answer is **Yes**. The playground displays the
more likely answer as **leans Yes** or **leans No**, together with its probability. Noul
does not have a separate confidence value.

### Score

Use Score to measure degree along ordered, clearly described levels. Do not use it for a
simple yes-or-no question.

For example, to judge how different two classes are, define:

0. No meaningful difference
1. Small non-behavioral differences
2. Significant behavioral differences

The model returns a weighted position across the levels, so the score can be fractional. If
the level probabilities are 86% for level 0, 10% for level 1, and 4% for level 2, the result
is:

```text
0 × 0.86 + 1 × 0.10 + 2 × 0.04 = 0.18
```

The playground displays this as **scored 0.18 / 2**. It also shows distribution confidence,
which indicates how concentrated the probabilities are across the levels.

## Attach files and ABAP objects

Place the cursor where the attachment should appear in the State field, then select:

- **Add file** to choose a local text file.
- **Add ABAP object** to choose a connected SAP system, search for an object, and attach
  its source.

The playground inserts a placeholder into the State field. The placeholder is replaced with
the attachment content only when the request is sent. Each attachment displays its
character count, along with an approximate expanded-state character count.

## Request limits

Jev limits tokens rather than characters, so ABAP FS does not reject a Jev request based on
character count alone. Around 80,000 expanded characters may exceed the context limit, but
the actual token count depends on the content and question. If TypeSafe rejects an oversized
request, reduce the state or attach a smaller section.

Laya publishes exact limits, and ABAP FS refuses a request that breaks one before sending
it:

- 50,000 characters of state, measured on the serialized text
- 64 questions in one request
- 100 options in one Choice question
- 32 levels in one Score question
- 512 options and score levels added up across all questions

A request must also have a state; Laya rejects an empty one.

## Read the result

The default result view shows the selected answer, probabilities, confidence where
available, model version, and token usage.

When the model did not read the whole state, the result says so and reports how many tokens
were dropped. Raise the token budget or shorten the state before trusting that answer.

Select **Show raw output** to inspect the complete structured response in a popup. This is
useful when you need exact values beyond the visual summary.

## If an engine is unavailable

The playground reports a clear message when:

- The credential is missing or rejected, naming the variable to check
- The engine cannot be reached, which for Laya usually means the local server is not running
- The request times out or is rate-limited
- The state exceeds the engine's limit

Both engines are optional. These failures do not affect SAP connections or other ABAP FS
features.
