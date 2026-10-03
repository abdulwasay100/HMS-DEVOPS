resource "google_cloud_run_v2_service" "hms_backend" {
  name     = "hms-backend"
  location = "asia-south1"

  client         = "gcloud"
  client_version = "551.0.0"

  template {
    service_account = "609703755852-compute@developer.gserviceaccount.com"

    containers {
      image = "asia-south1-docker.pkg.dev/hms-devops-510406/hms-repo/hms-backend:v1"

      ports {
        container_port = 8080
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "DB_HOST"
        value = "172.19.0.3"
      }

      env {
        name  = "DB_PORT"
        value = "3306"
      }

      env {
        name  = "DB_USER"
        value = "hms_user"
      }

      env {
        name  = "DB_NAME"
        value = "hms"
      }

      env {
        name  = "DB_CONNECTION_LIMIT"
        value = "10"
      }

      env {
        name  = "CORS_ORIGIN"
        value = "https://hms-frontend-609703755852.asia-south1.run.app"
      }

      env {
        name = "DB_PASSWORD"

        value_source {
          secret_key_ref {
            secret  = "hms-db-password"
            version = "latest"
          }
        }
      }

      env {
        name = "JWT_SECRET"

        value_source {
          secret_key_ref {
            secret  = "hms-jwt-secret"
            version = "latest"
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }

    volumes {
      name = "cloudsql"

      cloud_sql_instance {
        instances = [
          "hms-devops-510406:asia-south1:hms-mysql"
        ]
      }
    }

    vpc_access {
      connector = "hms-connector"
      egress    = "PRIVATE_RANGES_ONLY"
    }
  }
}

resource "google_cloud_run_v2_service" "hms_frontend" {
  name     = "hms-frontend"
  location = "asia-south1"

  client         = "gcloud"
  client_version = "551.0.0"

  template {
    containers {
      image = "asia-south1-docker.pkg.dev/hms-devops-510406/hms-repo/hms-frontend:v2"

      ports {
        container_port = 3000
      }
    }
  }
}
