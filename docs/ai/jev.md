# Jev Integration and Playground

Jev is a decision model from TypeSafe AI. Unlike a conversational AI model, it does not
write an explanation or generate code. It answers structured questions with probabilities
that software can use directly.

ABAP FS currently provides an optional Jev playground. No ABAP FS workflow calls Jev
automatically. The playground lets you try Jev with your own text, files, and ABAP objects
while future ABAP-specific uses are being developed.

## Before you start

You need your own TypeSafe API key. Set it in the `TYPESAFE_API_KEY` environment variable
before starting VS Code.

=== "PowerShell"

    ```powershell
    $env:TYPESAFE_API_KEY = "your-key"
    ```

=== "macOS or Linux"

    ```bash
    export TYPESAFE_API_KEY="your-key"
    ```

The variable name is case-sensitive on macOS and Linux. If VS Code is already running,
close all VS Code windows and start it again from the configured environment.

!!! warning "Data is sent to TypeSafe"
    The state, question, options or criteria, selected model, and attachment contents are
    sent to TypeSafe when you select **Ask Jev**. Do not submit SAP source code or other
    private data unless your organization permits sending it to TypeSafe.

## Open the playground

Open the Command Palette (`Ctrl+Shift+P`) and run:

**ABAP FS: Ask Jev**

The playground does not require a SAP connection unless you want to attach an ABAP object.

## Ask a question

1. Enter the **State** Jev should evaluate. Any text is accepted, including JSON text.
2. Choose a **Question type**.
3. Write one focused **Question** about the state.
4. Define the available options or criteria.
5. Optionally select a model or change the timeout.
6. Select **Ask Jev**.

Leave the model empty to use TypeSafe's current `jev-latest` model.

## Choose the right question type

### Choice

Use Choice when Jev should select one option from a defined set.

For example, given an ABAP object description, you could ask which category fits best and
provide `business`, `technical`, and `generated` as options. Option descriptions are
optional but useful when a short label is ambiguous.

The result shows:

- The option Jev chose
- Jev's confidence in that choice
- The probability assigned to every option

Confidence and the selected option's probability are related but not identical. Confidence
summarizes how strongly the complete distribution favors one option.

### Noul

Use Noul for a yes-or-no judgment.

For example: _"Do these two classes behave differently?"_

Jev returns the probability that the answer is **Yes**. The playground displays the more
likely answer as **Jev leans Yes** or **Jev leans No**, together with its probability.
Noul does not have a separate confidence value.

### Score

Use Score to measure degree along ordered, clearly described levels. Do not use it for a
simple yes-or-no question.

For example, to judge how different two classes are, define:

0. No meaningful difference
1. Small non-behavioral differences
2. Significant behavioral differences

Jev returns a weighted position across the levels, so the score can be fractional. If the
level probabilities are 86% for level 0, 10% for level 1, and 4% for level 2, the result is:

```text
0 × 0.86 + 1 × 0.10 + 2 × 0.04 = 0.18
```

The playground displays this as **Jev scored 0.18 / 2**. It also shows distribution
confidence, which indicates how concentrated the probabilities are across the levels.

## Attach files and ABAP objects

Place the cursor where the attachment should appear in the State field, then select:

- **Add file** to choose a local text file.
- **Add ABAP object** to choose a connected SAP system, search for an object, and attach
  its source.

The playground inserts a placeholder into the State field. The placeholder is replaced
with the attachment content only when the request is sent. Each attachment displays its
character count, along with an approximate expanded-state character count.

Jev limits tokens rather than characters, so ABAP FS does not reject a request based only
on character count. Around 80,000 expanded characters may exceed the context limit, but
the actual token count depends on the content and question. If TypeSafe rejects an
oversized request, reduce the state or attach a smaller section.

## Read the result

The default result view shows the selected answer, probabilities, confidence where
available, model version, and token usage.

Select **Show raw output** to inspect the complete structured response in a popup. This is
useful when you need exact values beyond the visual summary.

## If Jev is unavailable

The playground reports a clear message when:

- `TYPESAFE_API_KEY` is not set or is invalid
- The TypeSafe service cannot be reached
- The request times out or is rate-limited
- The supplied state exceeds Jev's context limit

Jev is optional. These failures do not affect SAP connections or other ABAP FS features.
