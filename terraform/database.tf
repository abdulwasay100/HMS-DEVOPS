resource "google_sql_database_instance" "hms_mysql" {
  name             = "hms-mysql"
  database_version = "MYSQL_8_0"
  region           = "asia-south1"

  settings {
    tier                        = "db-f1-micro"
    disk_type                   = "PD_SSD"
    disk_size                   = 10
    availability_type           = "ZONAL"
    enable_dataplex_integration = true

    ip_configuration {
      ipv4_enabled    = false
      private_network = "projects/hms-devops-510406/global/networks/default"
    }
  }
}

resource "google_sql_database" "hms_database" {
  name     = "hms"
  instance = google_sql_database_instance.hms_mysql.name
}

resource "google_sql_user" "hms_user" {
  name     = "hms_user"
  instance = google_sql_database_instance.hms_mysql.name
}
