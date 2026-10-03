resource "google_secret_manager_secret" "hms_db_password" {
  secret_id = "hms-db-password"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "hms_jwt_secret" {
  secret_id = "hms-jwt-secret"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "hms_db_password_access" {
  secret_id = google_secret_manager_secret.hms_db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:609703755852-compute@developer.gserviceaccount.com"
}

resource "google_secret_manager_secret_iam_member" "hms_jwt_secret_access" {
  secret_id = google_secret_manager_secret.hms_jwt_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:609703755852-compute@developer.gserviceaccount.com"
}
