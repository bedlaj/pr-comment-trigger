#!/usr/bin/env node

import {ExecOptions} from "@actions/exec/lib/interfaces";
import core = require("@actions/core");
import github = require("@actions/github");
import exec = require("@actions/exec");
import grok = require("grok-js");
import * as Context from "@actions/github/lib/context";
import {GitHub} from "@actions/github/lib/utils";

const {
    GITHUB_ACTOR,
    GITHUB_WORKSPACE,
    HOME,
    GITHUB_REPOSITORY,
    GITHUB_RUN_ID
} = process.env;
const TOKEN: string = core.getInput("token", { required: true });
const client: InstanceType<typeof GitHub> = github.getOctokit(TOKEN);
const context: Context.Context = github.context;
const { owner, repo } = context.repo;
const WORKFLOW_URL: string = `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
const patterns: grok.GrokCollection = grok.loadDefaultSync();

async function run() {
    const command: string = core.getInput("command", { required: true });
    const cancel: boolean = core.getInput("cancel", { required: false }) === "true";
    const reply: boolean = core.getInput("reply", { required: false }) === "true";
    const role: string = core.getInput("role", { required: false });
    const checkout: boolean = core.getInput("checkout", { required: false }) === "true";

    if (
        context.eventName === "issue_comment" &&
        !context?.payload?.issue?.pull_request
    ) {
        core.info("Not a pull request comment");
        core.setOutput("triggered", false);
        if (cancel) {
            await cancelSelf();
        }
        return;
    }

    const body: string =
        context.eventName === "issue_comment"
            ? context?.payload?.comment?.body
            : context?.payload?.pull_request?.body;

    if (!messageMatchPattern(body, command)) {
        core.info("Comment does not match pattern");
        if (cancel) {
            await cancelSelf();
        }
        return;
    }

    if (role !== "ALL" && !(await commenterHasRole(role))) {
        await comment(
            `Role ${role} is required to execute command.`
        ).catch(_ => {});
        core.setOutput("triggered", false);
        return;
    }

    core.setOutput("triggered", true);
    await react("+1").catch(reason =>
        core.setFailed(`React failed failed: ${reason}`)
    );

    if (reply) {
        await comment(`Executed workflow: ${WORKFLOW_URL}`).catch(reason =>
            core.setFailed(`Reply failed: ${reason}`)
        );
    }

    if (checkout) {
        await checkoutBranch().catch(reason =>
            core.setFailed(`Checkout failed: ${reason}`)
        );
    }
}

function messageMatchPattern(message: string, messagePattern: string) {
    const pattern: grok.GrokPattern = patterns.createPattern(messagePattern);
    const result: any = pattern.parseSync(message);

    if (result != null) {
        core.setOutput("command", result);
        for (const [key, value] of Object.entries(result)) {
            core.setOutput(`command.${key}`, value);
        }
        return true;
    }
    return false;
}

async function react(reaction: any) {
    if (context.eventName === "issue_comment") {
        await client.reactions.createForIssueComment({
            owner,
            repo,
            comment_id: context!.payload!.comment!.id,
            content: reaction
        });
    } else {
        await client.reactions.createForIssue({
            owner,
            repo,
            issue_number: context!.payload!.issue!.number,
            content: reaction
        });
    }
}

async function comment(message: string) {
    await client.issues.createComment({
        owner,
        repo,
        issue_number: context!.payload!.issue!.number!,
        body: `@${GITHUB_ACTOR} ${message}`
    });
}

async function checkoutBranch() {
    const options: ExecOptions = {};
    options['listeners'] = {
        stdout: data => {
            core.info(data.toString());
        },
        stderr: data => {
            core.warning(data.toString());
        }
    };
    options.env = options.env || {};
    options.env["GITHUB_TOKEN"] = TOKEN;
    options.env["GITHUB_USER"] = GITHUB_ACTOR!;
    options.env["HUB_PROTOCOL"] = "https";
    options.env["GITHUB_REPOSITORY"] = context!.payload!.repository!.full_name!;
    options.env["HOME"] = HOME || '.';
    options.env["PATH"] =
        "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
    options.cwd = GITHUB_WORKSPACE;
    const pr_number = context?.payload?.issue?.number;
    await exec.exec(
        "hub",
        ["clone", context!.payload!.repository!.full_name!, GITHUB_WORKSPACE || '.'],
        options
    );
    await exec.exec(
        "hub",
        ["pr", "checkout", `${pr_number}`, `pr-${pr_number}`],
        options
    );
    core.info(`PR ${pr_number} checkout successful`);
}

async function cancelSelf() {
    await client.actions.cancelWorkflowRun({
        owner: owner,
        repo: repo,
        run_id: Number(GITHUB_RUN_ID)
    });
}

function commenterHasRole(role: string): boolean {
    return context!.payload!.comment!.get("author_association") === role;
}

run().catch(err => {
    core.error(err);
    core.setFailed("Unexpected error");
});
