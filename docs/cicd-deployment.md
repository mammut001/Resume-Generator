# GitHub Actions VPS Deployment

Every push to `main` triggers `.github/workflows/deploy.yml`. The workflow connects to the VPS over SSH, checks out the exact commit that triggered the run, rebuilds the Docker image, recreates the service, and waits for `/health` to report success.

## One-time GitHub setup

Create a repository or `production` environment secret named `VPS_SSH_KEY`:

1. Open the GitHub repository.
2. Go to **Settings > Secrets and variables > Actions**.
3. Add `VPS_SSH_KEY` containing the complete private SSH key that can log in as `ubuntu@149.56.97.109`.
4. Keep the matching public key in `/home/ubuntu/.ssh/authorized_keys` on the VPS.

The private key must include its header and footer, for example `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----`.

## VPS requirements

The workflow expects:

- deployment directory: `/home/ubuntu/resume-generator`
- persistent environment file: `/home/ubuntu/resume-generator/.env`
- persistent data directory: `/home/ubuntu/resume-generator/data`
- Docker Engine, the Docker Compose plugin, Git, and curl
- the `ubuntu` user can run Docker without sudo

The workflow initializes the deployment directory as a Git checkout when `.git` is absent. It deliberately preserves `.env`, `.env.*`, and `data/` while resetting every tracked source file to the triggering commit.

## Operation

- Push to `main` to deploy automatically.
- Use **Actions > Deploy to VPS > Run workflow** to redeploy manually.
- Deployments are serialized so two pushes cannot rebuild the same production service concurrently.
- A run succeeds only after the VPS checkout matches the triggering commit and `http://127.0.0.1:8790/health` returns `{ "ok": true }`.

If a run fails, inspect the final step. It prints the Git state, Compose status, and recent container logs. A failure in **Validate deployment secret** means `VPS_SSH_KEY` is missing from the repository or `production` environment.
