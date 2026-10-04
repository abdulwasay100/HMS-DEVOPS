# Hotel Management System — DevOps Project

A Hotel Management System portfolio project demonstrating application development and a production-style DevOps workflow on Google Cloud. The application covers hotel operations such as rooms, bookings, food orders, inventory, billing, customers, staff, and reports.

The project uses Docker and Docker Compose for containers, Cloud Run for application hosting, Cloud SQL for MySQL, Secret Manager for sensitive configuration, Terraform for infrastructure as code, and GitHub Actions for CI/CD.

## Architecture

```text
Developer → GitHub → GitHub Actions (OIDC)
                         |
                         v
                  Artifact Registry
                         |
                         v
                    Cloud Run
                  /            \
          Next.js Frontend   Express Backend
                                  |
                     VPC Access Connector
                                  |
                                  v
                         Private Cloud SQL
                             (MySQL)

Secret Manager ───────────────→ Backend
Terraform ── manages supported GCP infrastructure
```

## Technology Stack

- **Frontend:** Next.js, TypeScript, Tailwind CSS
- **Backend:** Node.js, Express, REST API
- **Database:** MySQL 8
- **Containers:** Docker, Docker Compose
- **CI/CD:** GitHub Actions
- **Cloud:** Google Cloud Run, Artifact Registry, Cloud SQL, Secret Manager, VPC Access
- **Infrastructure as Code:** Terraform
- **Authentication to GCP:** Workload Identity Federation (OIDC)

## Main Application Features

- Dashboard for sales, orders, room status, and low-stock items
- Room and booking management
- Food menu and customer orders
- Inventory tracking and low-stock warnings
- Configurable automatic ingredient deduction for completed orders
- Billing, taxes, discounts, payment status, and printable receipts
- Customer and staff management
- Role-based access for Admin, Manager, and Staff
- Sales, inventory, and room-occupancy reports

Feature availability depends on the implementation in the current branch.

## Repository Structure

```text
HMS-DEVOPS/
├── frontend/                  # Next.js frontend
├── backend/                   # Express API and database logic
├── terraform/                 # GCP infrastructure configuration
├── .github/workflows/         # GitHub Actions CI/CD
├── docker-compose.yml         # Local containers
├── .gitignore
└── README.md
```

## Prerequisites

For local development, install Git, Node.js 20+, npm, Docker Desktop with Docker Compose, and optionally MySQL 8 if you are not using the Compose database. For cloud operations, install the Google Cloud CLI (`gcloud`) and Terraform.

## Run Locally

### 1. Clone the repository

```bash
git clone https://github.com/abdulwasay100/HMS-DEVOPS.git
cd HMS-DEVOPS
```

### 2. Configure the backend

Create `backend/.env` from `backend/.env.example` and fill in values for your environment. Never commit real `.env` files or credentials.

For direct local development, configure the backend to use your local MySQL instance. For Docker Compose, use the database service name `mysql` and container port `3306`; do not use `localhost` from inside the backend container.

### 3. Install backend dependencies and initialize the database

```bash
cd backend
npm ci
npm run db:setup
```

The setup script runs database migrations and seeding. Follow its output for the initial admin account details. If demo seeding is supported in your branch, you can optionally run:

```bash
npm run seed:demo
```

### 4. Install frontend dependencies

In a second terminal:

```bash
cd frontend
npm ci
```

Set the frontend API URL using the variable expected by the current code, such as `NEXT_PUBLIC_API_URL`. For direct local development, the API commonly runs at `http://localhost:4000`.

### 5. Start the applications

Use the scripts listed in each folder's `package.json`. Common development commands are:

```bash
# Backend
cd backend
npm run dev
```

```bash
# Frontend, in another terminal
cd frontend
npm run dev
```

Expected direct-development URLs, if using the default ports:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`

## Run with Docker Compose

From the project root:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f backend
```

With the current Compose port mapping:

- Frontend: `http://localhost:3001`
- Backend: `http://localhost:4001`
- MySQL: `localhost:3308`

Inside the Compose network, the backend connects to `mysql:3306`.

Stop the project containers without deleting the database volume:

```bash
docker compose down
```

**Avoid `docker compose down -v` unless you intentionally want to delete the database volume and its data.**

## Google Cloud Deployment

Current GCP configuration:

| Resource | Name / setting | Purpose |
|---|---|---|
| Project | `hms-devops-510406` | Hosts the cloud resources |
| Region | `asia-south1` | Primary deployment region |
| Artifact Registry | `hms-repo` | Stores Docker images |
| Cloud Run frontend | `hms-frontend` | Hosts Next.js |
| Cloud Run backend | `hms-backend` | Hosts the Express API |
| Cloud SQL | `hms-mysql` | Private MySQL instance |
| Database | `hms` | Application data |
| VPC connector | `hms-connector` | Private network connectivity |
| Secret Manager | `hms-db-password`, `hms-jwt-secret` | Sensitive runtime configuration |

### Live URLs

- **Frontend:** https://hms-frontend-vnu5cxvita-el.a.run.app
- **Backend:** https://hms-backend-vnu5cxvita-el.a.run.app

These URLs are specific to the current environment and can change if services are recreated.

### Deployment flow

1. A developer pushes code to `master`.
2. GitHub Actions authenticates to Google Cloud through Workload Identity Federation (OIDC).
3. The workflow builds backend and frontend Docker images.
4. Images are pushed to Artifact Registry using the Git commit SHA as the tag.
5. The workflow deploys the backend and frontend to Cloud Run.
6. The backend reads its database password and JWT secret from Secret Manager and connects to private Cloud SQL through the configured network path.

Cloud SQL uses private IP access. Direct connections from an arbitrary public computer are not expected to work.

## Terraform

Terraform configuration is in `terraform/`. Typical checks:

```bash
cd terraform
terraform init
terraform fmt -check
terraform validate
terraform plan
```

Review the complete plan before applying:

```bash
terraform apply
```

Some existing resources may have been created manually and imported into Terraform state. Always review changes carefully, especially if the plan proposes replacement or deletion of existing resources. Do not commit Terraform state files, `.terraform/`, or real `.tfvars` files.

## CI/CD

The GitHub Actions workflow under `.github/workflows/` runs on pushes to `master`. It checks out the code, authenticates using OIDC, builds and pushes both Docker images, and deploys both Cloud Run services.

To verify a deployment, open the repository's **Actions** tab, inspect the latest workflow run, and confirm that all steps passed. Then test the live application.

## Security Notes

- Store production secrets in Secret Manager, not in source code.
- Rotate credentials that were exposed during development before using real hotel data.
- Use strong, unique database credentials and JWT secrets.
- Apply least-privilege IAM permissions.
- Keep Cloud SQL private unless a reviewed requirement says otherwise.
- Enforce validation and authorization on the backend, not only in the frontend.
- Plan database backups and recovery before production use.
- Review GCP costs regularly; deployed resources may incur charges.

## Troubleshooting

### Backend cannot connect to MySQL
Check `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`. In Compose, use `mysql:3306`. For Cloud SQL, verify private networking, the VPC connector, and Cloud Run settings.

### Login fails
Check the email and password provided by the seed process. A bcrypt hash cannot be converted back to the original password. Use an authorized reset process that can reach the database; do not expose hashes or secrets in logs.

### Cloud Run deployment fails
Inspect the failed GitHub Actions step and Cloud Run logs. Verify Workload Identity Federation, IAM permissions, Artifact Registry access, Secret Manager access, the frontend API URL, and backend CORS configuration.

### Terraform proposes unexpected changes
Inspect `terraform plan` and check for drift between the live GCP resources and Terraform configuration. Do not apply unexpected resource replacements or deletions until the state and configuration are reconciled.

## DevOps Skills Demonstrated

- Git and GitHub source control
- Docker image builds and Docker Compose
- GitHub Actions CI/CD
- Keyless GitHub-to-GCP authentication using OIDC
- Artifact Registry image publishing
- Cloud Run deployment
- Private Cloud SQL networking
- Secret Manager and IAM
- Terraform infrastructure as code
- Deployment validation and troubleshooting

## Future Improvements

- Automated tests and code-quality checks in CI
- Dependency and container vulnerability scanning
- Database backup and restore testing
- Monitoring, alerting, and structured logging
- Separate staging and production environments
- Terraform remote state with controlled access
- A controlled database migration strategy for releases

---

**Project:** Hotel Management System — DevOps Portfolio Project  
**Repository:** https://github.com/abdulwasay100/HMS-DEVOPS  
**Cloud provider:** Google Cloud Platform
