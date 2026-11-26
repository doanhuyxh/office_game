using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Notification.Infrastructure.Migrations
{
    /// <inheritdoc />
    /// TEST-237: target (type / id / params) cho thông báo. Dòng cũ được backfill bằng C# ngay sau migration (NotificationMigrator.BackfillTargetsAsync,
    /// tách link theo mẫu đã biết — NotificationTargets.FromLink) để dùng chung quy tắc đã test.
    public partial class NotificationTargets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "TargetId",
                schema: "notifications",
                table: "notifications",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TargetParams",
                schema: "notifications",
                table: "notifications",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TargetType",
                schema: "notifications",
                table: "notifications",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_notifications_TargetType_TargetId",
                schema: "notifications",
                table: "notifications",
                columns: new[] { "TargetType", "TargetId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_notifications_TargetType_TargetId",
                schema: "notifications",
                table: "notifications");

            migrationBuilder.DropColumn(
                name: "TargetId",
                schema: "notifications",
                table: "notifications");

            migrationBuilder.DropColumn(
                name: "TargetParams",
                schema: "notifications",
                table: "notifications");

            migrationBuilder.DropColumn(
                name: "TargetType",
                schema: "notifications",
                table: "notifications");
        }
    }
}
