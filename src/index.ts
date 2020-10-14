#!/usr/bin/env node

import { ExecOptions } from "@actions/exec/lib/interfaces";
import core = require("@actions/core");
import github = require("@actions/github");
import exec = require("@actions/exec");
import grok = require("grok-js");
import * as Context from "@actions/github/lib/context";
import { GitHub } from "@actions/github/lib/utils";

const {
    GITHUB_ACTOR,
    GITHUB_WORKSPACE,
    HOME,
    GITHUB_REPOSITORY,
    GITHUB_RUN_ID,
} = process.env;
const TOKEN: string = core.getInput("token", { required: true });
const client: InstanceType<typeof GitHub> = github.getOctokit(TOKEN);
const context: Context.Context = github.context;
const { owner, repo } = context.repo;
const { issues, actions, reactions } = client;
const WORKFLOW_URL: string = `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
const patterns: grok.GrokCollection = grok.loadDefaultSync();

async function run() {
    const command: string = core.getInput("command", { required: true });
    const cancel: boolean = core.getInput("cancel") === "true";
    const reply: boolean = core.getInput("reply") === "true";
    const role: string = core.getInput("role");
    const checkout: boolean = core.getInput("checkout") === "true";

    if (
        context.eventName === "issue_comment" &&
        !context?.payload?.issue?.pull_request
    ) {
        core.info("Not a pull request comment");
        core.setOutput("triggered", false);
        if (cancel) {
            await cancelSelf().catch((reason) =>
                core.setFailed(`Cancel failed: ${reason}`)
            );
        }
        return;
    }

    const body: string =
        context.eventName === "issue_comment"
            ? context?.payload?.comment?.body
            : context?.payload?.pull_request?.body;

    if (!messageMatchPattern(body, command)) {
        core.info(`Comment does not match pattern ${command}`);
        if (cancel) {
            await cancelSelf().catch((reason) =>
                core.setFailed(`Cancel failed: ${reason}`)
            );
        }
        return;
    }

    if (role !== "ALL" && !commenterHasRole(role)) {
        await comment(
            `Role ${role} is required to execute command.`
        ).catch((_) => {});
        core.setOutput("triggered", false);
        return;
    }

    core.setOutput("triggered", true);
    await react("+1").catch((reason) =>
        core.setFailed(`React failed failed: ${reason}`)
    );

    if (reply) {
        await comment(`Executed workflow: ${WORKFLOW_URL}`).catch((reason) =>
            core.setFailed(`Reply failed: ${reason}`)
        );
    }

    if (checkout) {
        await checkoutBranch().catch((reason) =>
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
            core.setOutput(key, value);
        }
        return true;
    }
    return false;
}

async function react(reaction: any) {
    if (context.eventName === "issue_comment") {
        await reactions.createForIssueComment({
            owner,
            repo,
            comment_id: context!.payload!.comment!.id,
            content: reaction,
        });
    } else {
        await reactions.createForIssue({
            owner,
            repo,
            issue_number: context!.payload!.issue!.number,
            content: reaction,
        });
    }
}

async function comment(message: string) {
    await issues.createComment({
        owner,
        repo,
        issue_number: context!.payload!.issue!.number!,
        body: `@${GITHUB_ACTOR} ${message}`,
    });
}

async function checkoutBranch() {
    const options: ExecOptions = {};
    options["listeners"] = {
        stdout: (data) => {
            core.info(data.toString());
        },
        stderr: (data) => {
            console.warn(data.toString());
        },
    };
    options.env = {
        GITHUB_TOKEN: TOKEN,
        GITHUB_USER: GITHUB_ACTOR!,
        HUB_PROTOCOL: "https",
        GITHUB_REPOSITORY: context!.payload!.repository!.full_name!,
        HOME: HOME || ".",
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    };
    options.cwd = GITHUB_WORKSPACE;
    const pr_number = context?.payload?.issue?.number;
    await exec.exec(
        "hub",
        [
            "clone",
            context!.payload!.repository!.full_name!,
            GITHUB_WORKSPACE || ".",
        ],
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
    await actions.cancelWorkflowRun({
        owner: owner,
        repo: repo,
        run_id: Number(GITHUB_RUN_ID),
    });
}

function commenterHasRole(role: string): boolean {
    return context!.payload!.comment!.get("author_association") === role;
}

run().catch((err) => {
    core.error(err);
    core.setFailed("Unexpected error");
});
