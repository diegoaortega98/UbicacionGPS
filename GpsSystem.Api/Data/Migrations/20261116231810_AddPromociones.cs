using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GpsSystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPromociones : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "PromocionId",
                table: "Viajes",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Promociones",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Codigo = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PorcentajeDescuento = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    EstaActiva = table.Column<bool>(type: "boolean", nullable: false),
                    FechaExpiracion = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Promociones", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Viajes_PromocionId",
                table: "Viajes",
                column: "PromocionId");

            migrationBuilder.CreateIndex(
                name: "IX_Promociones_Codigo",
                table: "Promociones",
                column: "Codigo",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Viajes_Promociones_PromocionId",
                table: "Viajes",
                column: "PromocionId",
                principalTable: "Promociones",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Viajes_Promociones_PromocionId",
                table: "Viajes");

            migrationBuilder.DropTable(
                name: "Promociones");

            migrationBuilder.DropIndex(
                name: "IX_Viajes_PromocionId",
                table: "Viajes");

            migrationBuilder.DropColumn(
                name: "PromocionId",
                table: "Viajes");
        }
    }
}
