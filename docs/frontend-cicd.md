# Frontend CI/CD

This repository deploys the frontend from GitHub Actions by building a Docker image, pushing it to the Biatec Harbor registry, and applying Kubernetes manifests.

## What the pipeline does

The frontend workflows live in [.github/workflows/algo-safe-frontend-ci.yaml](../.github/workflows/algo-safe-frontend-ci.yaml) and [.github/workflows/algo-safe-frontend-cd.yaml](../.github/workflows/algo-safe-frontend-cd.yaml).

Validation workflow:

- installs workspace dependencies with pnpm
- builds the shared contracts package consumed by the frontend
- runs frontend lint, test, and build

Release workflow:

- builds the frontend Docker image from the monorepo root
- pushes the image to `harbor.de-4.biatec.io/biatec/algo-safe-frontend`
- applies Kubernetes namespace, deployment, service, and ingress manifests from [projects/algo-safe-frontend/deploy/k8s](../projects/algo-safe-frontend/deploy/k8s)

## Required GitHub secrets

Configure these repository secrets in GitHub at `Settings > Secrets and variables > Actions`.

`HARBOR_USERNAME`

- Harbor username with permission to push to `harbor.de-4.biatec.io/biatec/algo-safe-frontend`

`HARBOR_PASSWORD`

- Harbor password or robot account token for the same registry account

`KUBE_CONFIG_DATA`

- base64 encoded kubeconfig content for the target cluster
- generate it locally with:

```bash
base64 -w 0 ~/.kube/config
```

On Windows PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME/.kube/config"))
```

## Required GitHub repository variables

Configure these repository variables in GitHub at `Settings > Secrets and variables > Actions > Variables`.

`FRONTEND_HOSTNAME`

- public DNS name exposed by the ingress, for example `algo-safe.example.com`

`FRONTEND_TLS_SECRET_NAME`

- name of the TLS secret that cert-manager should create in the `algo-safe` namespace, for example `algo-safe-frontend-tls`

## Registry and cluster prerequisites

Before enabling the workflow, make sure all of the following already exist:

1. A Harbor project named `biatec` or equivalent permissions for the configured image repository.
2. A Kubernetes cluster reachable by the kubeconfig stored in `KUBE_CONFIG_DATA`.
3. An ingress controller that supports `ingressClassName: nginx`.
4. cert-manager is installed in the cluster and the `letsencrypt-dns` `ClusterIssuer` exists and can solve DNS challenges for `FRONTEND_HOSTNAME`.

## Deployment manifests

The frontend deployment assets are stored here:

- [projects/algo-safe-frontend/Dockerfile](../projects/algo-safe-frontend/Dockerfile)
- [projects/algo-safe-frontend/deploy/nginx/default.conf](../projects/algo-safe-frontend/deploy/nginx/default.conf)
- [projects/algo-safe-frontend/deploy/k8s/namespace.yaml](../projects/algo-safe-frontend/deploy/k8s/namespace.yaml)
- [projects/algo-safe-frontend/deploy/k8s/deployment.yaml](../projects/algo-safe-frontend/deploy/k8s/deployment.yaml)
- [projects/algo-safe-frontend/deploy/k8s/service.yaml](../projects/algo-safe-frontend/deploy/k8s/service.yaml)
- [projects/algo-safe-frontend/deploy/k8s/ingress.yaml](../projects/algo-safe-frontend/deploy/k8s/ingress.yaml)

`deployment.yaml` uses an `IMAGE_PLACEHOLDER` token. The CD workflow replaces it with the image built for the current commit before applying it.

`ingress.yaml` uses `FRONTEND_HOST_PLACEHOLDER` and `FRONTEND_TLS_SECRET_PLACEHOLDER`. The CD workflow replaces those values from GitHub repository variables, and cert-manager creates the TLS secret via the `letsencrypt-dns` cluster issuer annotation on the ingress.

## First-time setup checklist

1. Add the required GitHub secrets.
2. Add the required GitHub repository variables.
3. Verify the Harbor account can push to the target repository.
4. Verify the kubeconfig can create secrets and update deployments in the `algo-safe` namespace.
5. Create DNS for `FRONTEND_HOSTNAME` so it points at your ingress controller.
6. Verify the `letsencrypt-dns` `ClusterIssuer` is ready before the first release.
7. Push to `main` and confirm the `Release` workflow completes.