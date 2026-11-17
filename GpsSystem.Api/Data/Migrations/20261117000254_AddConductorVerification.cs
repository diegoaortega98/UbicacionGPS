using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GpsSystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddConductorVerification : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "EstadoVerificacion",
                table: "AspNetUsers",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "MotivoRechazo",
                table: "AspNetUsers",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UrlLicencia",
                table: "AspNetUsers",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UrlSOAT",
                table: "AspNetUsers",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UrlTarjetaPropiedad",
                table: "AspNetUsers",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EstadoVerificacion",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "MotivoRechazo",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "UrlLicencia",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "UrlSOAT",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "UrlTarjetaPropiedad",
                table: "AspNetUsers");
        }
    }
}
