"""
Name: publish.py
Purpose: Release utility for hive-core. Bumps the package version on a release branch, opens a PR,
    and (optionally) merges it and cuts the GitHub release that triggers the publish workflow.
Created: 2026-09-26
Author: Michael K. Steinberg

Flow (never commits to master directly):
    1. bump package.json + package-lock.json on release/<version>
    2. commit "Vibe-Bumped version to <version>", push, open a PR
    3. with --merge: merge the PR, then `gh release create v<version>` from master,
       which triggers .github/workflows/publish.yml

Requires: Python 3.10+, typer, git, gh (authenticated).
"""

import json
import re
import subprocess
import sys
from pathlib import Path

import click
import typer

app = typer.Typer(help="hive-core Publishing Utility", add_completion=False)

PACKAGE_JSON = Path("package.json")
PACKAGE_LOCK = Path("package-lock.json")
BASE_BRANCH = "master"
VERSION_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")
COMMIT_TRAILER = "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
PR_TRAILER = "🤖 Generated with [Claude Code](https://claude.com/claude-code)"

STATE = {"verbose": False}


def run(cmd: list[str], check: bool = True) -> str:
    """
    Runs a command and returns its stripped stdout, exiting the script on failure.

    Args:
        cmd: The command and its arguments.
        check: Whether to exit the script on a non-zero return code.

    Returns:
        The stripped stdout ("" when a non-checked command fails).
    """
    if STATE["verbose"]:
        typer.secho(f"> {' '.join(cmd)}", dim=True)

    result = subprocess.run(cmd, text=True, capture_output=True)
    if result.returncode != 0:
        if not check:
            return ""
        typer.secho(f"❌ Command failed: {' '.join(cmd)}", fg=typer.colors.RED)
        if result.stderr:
            typer.echo(result.stderr.strip())
        raise typer.Exit(code=1)
    return result.stdout.strip()


def parse_version(value: str) -> tuple[int, int, int]:
    """
    Parses a semver string (optionally prefixed with "v") into a tuple.

    Args:
        value: The version string.

    Returns:
        A tuple of (major, minor, patch).
    """
    match = VERSION_RE.match(value)
    if not match:
        typer.secho(f"❌ '{value}' is not a valid x.y.z version.", fg=typer.colors.RED)
        raise typer.Exit(code=1)
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def bump_version(current: str, bump: str) -> str:
    """
    Applies a bump type to a version.

    Args:
        current: The current x.y.z version.
        bump: One of patch, minor, major.

    Returns:
        The new version string.
    """
    major, minor, patch = parse_version(current)
    if bump == "major":
        return f"{major + 1}.0.0"
    if bump == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def update_manifests(version: str) -> list[Path]:
    """
    Writes the new version into package.json and package-lock.json (root package entries only).

    Args:
        version: The semantic version string.

    Returns:
        A list of paths that were updated.
    """
    updated: list[Path] = []
    for path in (PACKAGE_JSON, PACKAGE_LOCK):
        if not path.exists():
            continue
        content = path.read_text(encoding="utf-8")
        if path == PACKAGE_JSON:
            new_content, count = re.subn(
                r'("version"\s*:\s*)"[^"]*"', rf'\g<1>"{version}"', content, count=1
            )
        else:
            # First occurrence is the top-level version; the second is packages[""].version.
            new_content, count = re.subn(
                r'("version"\s*:\s*)"[^"]*"', rf'\g<1>"{version}"', content, count=2
            )
        if count == 0:
            continue
        path.write_text(new_content, encoding="utf-8")
        updated.append(path)
    return updated


@app.command()
def main(
    verbose: bool = typer.Option(False, "-v", "--verbose", help="Print all internal commands."),
    dry: bool = typer.Option(
        False, "--dry", help="Show the planned version and exit without touching git or GitHub."
    ),
    bump: str | None = typer.Option(
        None, "--bump", help="Bump type: patch, minor, or major. Bypasses the prompt."
    ),
    version_override: str | None = typer.Option(
        None, "--version", help="Explicit version to publish, bypassing the bump math."
    ),
    merge: bool = typer.Option(
        False,
        "--merge",
        help="Also merge the PR and create the GitHub release (which publishes the package).",
    ),
    yes: bool = typer.Option(False, "--yes", help="Skip the confirmation prompt."),
) -> None:
    """
    Bumps the version via a PR and optionally releases it.
    """
    STATE["verbose"] = verbose
    typer.secho(
        "🚀 hive-core Release Manager" + (" [DRY RUN]" if dry else "") + "\n",
        fg=typer.colors.CYAN,
        bold=True,
    )

    branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    if branch != BASE_BRANCH:
        typer.secho(f"❌ Must be on {BASE_BRANCH}. (Current: {branch})", fg=typer.colors.RED)
        raise typer.Exit(code=1)
    if run(["git", "status", "--porcelain"]):
        typer.secho("❌ Working directory is not clean.", fg=typer.colors.RED)
        raise typer.Exit(code=1)

    run(["git", "fetch", "origin", BASE_BRANCH])
    if run(["git", "rev-parse", "HEAD"]) != run(["git", "rev-parse", f"origin/{BASE_BRANCH}"]):
        typer.secho(f"❌ Local {BASE_BRANCH} is not in sync with origin.", fg=typer.colors.RED)
        raise typer.Exit(code=1)

    # package.json is the source of truth: releases here are also cut by manual dispatch,
    # so git tags can lag behind what is on the registry.
    current = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))["version"]
    typer.echo(f"Current Version: {typer.style(f'v{current}', fg=typer.colors.YELLOW)}")

    if version_override is not None:
        new_version = version_override.removeprefix("v")
        if parse_version(new_version) <= parse_version(current):
            typer.secho(
                f"❌ {new_version} is not strictly greater than {current}.", fg=typer.colors.RED
            )
            raise typer.Exit(code=1)
    else:
        bump_type = bump or typer.prompt(
            "Bump type", type=click.Choice(["patch", "minor", "major"]), default="patch"
        )
        if bump_type not in ("patch", "minor", "major"):
            typer.secho("❌ --bump must be one of: patch, minor, major.", fg=typer.colors.RED)
            raise typer.Exit(code=1)
        new_version = bump_version(current, bump_type)

    new_tag = f"v{new_version}"
    release_branch = f"release/{new_version}"

    if run(["git", "ls-remote", "--tags", "origin", new_tag]):
        typer.secho(f"❌ Tag {new_tag} already exists on origin.", fg=typer.colors.RED)
        raise typer.Exit(code=1)

    if dry:
        typer.secho(
            f"\n⚠️ Dry run: would open PR from {release_branch} for {new_tag}"
            + (" and release it." if merge else "."),
            fg=typer.colors.YELLOW,
        )
        return

    if not yes and not typer.confirm(f"Publish {new_tag}?", default=True):
        typer.echo("Aborted.")
        raise typer.Exit()

    run(["git", "checkout", "-b", release_branch])
    updated = update_manifests(new_version)
    run(["git", "add", *(p.as_posix() for p in updated)])
    run(["git", "commit", "-m", f"Vibe-Bumped version to {new_version}\n\n{COMMIT_TRAILER}"])
    run(["git", "push", "-u", "origin", release_branch])
    pr_url = run(
        [
            "gh", "pr", "create", "--base", BASE_BRANCH,
            "--title", f"Vibe-Bumped version to {new_version}",
            "--body", f"Bump @system-b90/hive-core to {new_version}.\n\n{PR_TRAILER}",
        ]
    )
    typer.echo(f"PR: {pr_url}")

    if not merge:
        typer.secho(
            f"\nAfter merging, run: gh release create {new_tag} --target {BASE_BRANCH} --generate-notes",
            fg=typer.colors.YELLOW,
        )
        return

    run(["gh", "pr", "merge", pr_url, "--merge", "--delete-branch"])
    run(["git", "checkout", BASE_BRANCH])
    run(["git", "pull", "--ff-only", "origin", BASE_BRANCH])
    release_url = run(
        ["gh", "release", "create", new_tag, "--target", BASE_BRANCH, "--generate-notes"]
    )
    typer.secho(f"\n🎉 Published {new_tag}", fg=typer.colors.GREEN, bold=True)
    typer.echo(f"  Release: {release_url}")
    typer.echo(f"  Action:  https://github.com/System-B90/hive-core/actions/workflows/publish.yml")


if __name__ == "__main__":
    # Windows consoles default to cp1252, which cannot encode the status emoji.
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")
    if not Path(".git").exists():
        typer.secho("❌ Must run from repository root.", fg=typer.colors.RED)
        sys.exit(1)
    app()
