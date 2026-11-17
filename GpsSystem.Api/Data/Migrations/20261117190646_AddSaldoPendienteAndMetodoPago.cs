using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GpsSystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSaldoPendienteAndMetodoPago : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "MetodoPago",
                table: "Viajes",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Efectivo");

            migrationBuilder.AddColumn<decimal>(
                name: "SaldoPendiente",
                table: "AspNetUsers",
                type: "numeric",
                nullable: false,
                defaultValue: 0m);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MetodoPago",
                table: "Viajes");

            migrationBuilder.DropColumn(
                name: "SaldoPendiente",
                table: "AspNetUsers");
        }
    }
}
