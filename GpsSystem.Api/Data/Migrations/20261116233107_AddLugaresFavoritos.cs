using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GpsSystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLugaresFavoritos : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DireccionCasa",
                table: "AspNetUsers",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DireccionTrabajo",
                table: "AspNetUsers",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "LatCasa",
                table: "AspNetUsers",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "LatTrabajo",
                table: "AspNetUsers",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "LngCasa",
                table: "AspNetUsers",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "LngTrabajo",
                table: "AspNetUsers",
                type: "double precision",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DireccionCasa",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "DireccionTrabajo",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "LatCasa",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "LatTrabajo",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "LngCasa",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "LngTrabajo",
                table: "AspNetUsers");
        }
    }
}
