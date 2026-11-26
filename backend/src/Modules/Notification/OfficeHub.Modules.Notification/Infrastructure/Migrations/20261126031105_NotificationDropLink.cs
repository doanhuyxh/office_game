using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Notification.Infrastructure.Migrations
{
    /// <inheritdoc />
    /// TEST-238 (G2): target là nguồn duy nhất — TargetType bắt buộc, xoá cột Link. Down thêm lại cột Link rỗng (client G1 tự định tuyến theo target).
    public partial class NotificationDropLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Dừng nếu còn dòng chưa có target: NotificationMigrator đã backfill (tách Link) trước khi chạy migration này —
            // còn sót nghĩa là có gì sai, không xoá cột Link để khỏi mất dữ liệu.
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM notifications.notifications WHERE "TargetType" IS NULL OR "TargetType" = '') THEN
                        RAISE EXCEPTION 'TEST-238: còn thông báo chưa có TargetType — backfill (NotificationMigrator.BackfillTargetsAsync) trước khi xoá cột Link';
                    END IF;
                END $$;
                """);

            migrationBuilder.AlterColumn<string>(
                name: "TargetType",
                schema: "notifications",
                table: "notifications",
                type: "character varying(40)",
                maxLength: 40,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40,
                oldNullable: true);

            migrationBuilder.DropColumn(
                name: "Link",
                schema: "notifications",
                table: "notifications");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "TargetType",
                schema: "notifications",
                table: "notifications",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40);

            migrationBuilder.AddColumn<string>(
                name: "Link",
                schema: "notifications",
                table: "notifications",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);
        }
    }
}
