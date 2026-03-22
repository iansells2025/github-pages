# CLAUDE.md

## Project Overview

This is a **GitHub Skills course template** that teaches beginners how to create and deploy a site using **GitHub Pages** with **Jekyll**. It is not a traditional application — it is an interactive, automated learning course hosted on GitHub.

When a learner creates a repository from this template, GitHub Actions workflows guide them through sequential steps, automatically progressing as they complete each task.

## Repository Structure

```
.
├── .github/
│   ├── dependabot.yml              # Dependabot config (monitors GitHub Actions monthly)
│   ├── steps/
│   │   ├── -step.txt               # Current step tracker (single digit: 0-5 or X)
│   │   ├── 0-welcome.md            # Step instructions (markdown)
│   │   ├── 1-enable-github-pages.md
│   │   ├── 2-configure-your-site.md
│   │   ├── 3-customize-your-homepage.md
│   │   ├── 4-create-a-blog-post.md
│   │   ├── 5-merge-your-pull-request.md
│   │   └── X-finish.md             # Completion step
│   └── workflows/                  # GitHub Actions workflows (one per step)
│       ├── 0-welcome.yml
│       ├── 1-enable-github-pages.yml
│       ├── 2-configure-your-site.yml
│       ├── 3-customize-your-homepage.yml
│       ├── 4-create-a-blog-post.yml
│       └── 5-merge-your-pull-request.yml
├── .gitignore
├── LICENSE                         # MIT License
└── README.md                       # Course landing page / current step instructions
```

## Key Technologies

- **Jekyll** — Static site generator used for the GitHub Pages site learners build
- **GitHub Actions** — Automates course step progression via event-driven workflows
- **GitHub Pages** — Hosts the site learners create
- **Minima** — Default Jekyll theme configured during the course

## How the Course Automation Works

1. `.github/steps/-step.txt` holds a single character (0–5 or X) representing the current step.
2. Each workflow file corresponds to a step and triggers on specific events (push, page_build, pull_request).
3. Workflows check two conditions before running:
   - The repository is **not** the template (`!github.event.repository.is_template`)
   - The current step matches the workflow's expected step number
4. On success, `skills/action-update-step@v2` increments the step counter and updates the README.

## Workflow Patterns

All workflows follow this structure:

```yaml
jobs:
  get_current_step:        # Reads .github/steps/-step.txt
    ...
  on_<step_name>:
    needs: get_current_step
    if: >-
      ${{ !github.event.repository.is_template
          && needs.get_current_step.outputs.current_step == <N> }}
    ...
```

**Workflow triggers by step:**
| Step | Trigger | Watches |
|------|---------|---------|
| 0 | `push` to `main` | Any push |
| 1 | `page_build` | GitHub Pages deployment |
| 2 | `push` to `my-pages` | `_config.yml` |
| 3 | `push` to `my-pages` | `index.md` |
| 4 | `push` to `my-pages` | `_posts/*.md` |
| 5 | `push` to `main` | Any push (merge PR) |

## Course Steps (Learner Path)

1. **Enable GitHub Pages** — Turn on Pages in repo Settings (source: main branch)
2. **Configure your site** — Add `theme: minima` to `_config.yml`
3. **Customize homepage** — Edit `index.md` with personal content
4. **Create a blog post** — Add `_posts/YYYY-MM-DD-title.md` with YAML frontmatter (`title`, `date`)
5. **Merge pull request** — Merge `my-pages` branch into `main`

## Branches

- **`main`** — Production/template branch; README shows current step
- **`my-pages`** — Learner's working branch (auto-created by step 0 workflow)

## Key Conventions

### Workflow Files
- Explicit `permissions` declarations (least privilege: `contents: read/write`, `pull-requests: write`)
- Ubuntu runners for performance
- `actions/checkout@v4` for checkout
- `skills/action-update-step@v2` for step progression

### Jekyll Content
- Blog posts must follow naming: `_posts/YYYY-MM-DD-title.md`
- Blog posts require YAML frontmatter with `title` and `date` fields
- Site config lives in `_config.yml` at repo root
- Homepage is `index.md` at repo root

### General
- No traditional build system, test suite, or package manager — this is a pure template/course repo
- All content is Markdown and YAML
- MIT licensed

## Development Guidelines

When modifying this repository:

- **Step content** lives in `.github/steps/*.md` — edit these to change course instructions
- **Workflow logic** lives in `.github/workflows/*.yml` — edit these to change step triggers or validation
- **Step tracking** uses `.github/steps/-step.txt` — the single digit controls which workflow runs next
- Keep workflows idempotent; they may be re-triggered
- Test changes by creating a repo from the template and walking through the course
- The README is dynamically replaced by workflow steps — do not expect manual README edits to persist through the course
