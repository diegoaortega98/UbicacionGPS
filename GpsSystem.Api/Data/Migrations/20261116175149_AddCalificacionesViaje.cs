using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GpsSystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCalificacionesViaje : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Calificacion",
                table: "Viajes",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ComentarioCalificacion",
                table: "Viajes",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "PromedioCalificacion",
                table: "AspNetUsers",
                type: "double precision",
                nullable: false,
                defaultValue: 5.0);

            migrationBuilder.AddColumn<int>(
                name: "TotalCalificaciones",
                table: "AspNetUsers",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Calificacion",
                table: "Viajes");

            migrationBuilder.DropColumn(
                name: "ComentarioCalificacion",
                table: "Viajes");

            migrationBuilder.DropColumn(
                name: "PromedioCalificacion",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "TotalCalificaciones",
                table: "AspNetUsers");
        }
    }
}
