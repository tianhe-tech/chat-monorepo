ALTER TABLE "mcp"."server_configs" DROP CONSTRAINT "server_configs_name_unique";--> statement-breakpoint
ALTER TABLE "mcp"."server_configs" DROP CONSTRAINT "server_configs_url_unique";--> statement-breakpoint
ALTER TABLE "mcp"."server_configs" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp"."server_configs" ADD COLUMN "command" text[];--> statement-breakpoint
ALTER TABLE "mcp"."server_configs" ADD CONSTRAINT "server_configs_userId_scope_name_unique" UNIQUE("user_id","scope","name");--> statement-breakpoint
ALTER TABLE "mcp"."server_configs" ADD CONSTRAINT "server_configs_userId_scope_url_unique" UNIQUE("user_id","scope","url");--> statement-breakpoint
ALTER TABLE "mcp"."server_configs" ADD CONSTRAINT "server_configs_userId_scope_command_unique" UNIQUE("user_id","scope","command");