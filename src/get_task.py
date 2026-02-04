import os
import json
import boto3

ddb = boto3.resource("dynamodb")
TABLE_NAME = os.environ["TABLE_NAME"]


def _resp(status_code: int, body_obj=None):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
        },
        "body": "" if body_obj is None else json.dumps(body_obj),
    }


def lambda_handler(event, context):
    path = event.get("pathParameters") or {}
    task_id = (path.get("id") or "").strip()

    if not task_id:
        return _resp(400, {"message": "Missing path parameter: id"})

    pk = f"TASK#{task_id}"
    table = ddb.Table(TABLE_NAME)

    resp = table.get_item(Key={"PK": pk})
    item = resp.get("Item")

    if not item or item.get("EntityType") != "Task":
        return _resp(404, {"message": "Task not found"})

    task = {
        "id": item.get("TaskId"),
        "title": item.get("Title"),
        "category": item.get("Category"),
        "status": item.get("Status"),
        "due_date": item.get("DueDate"),
        "description": item.get("Description"),
        "created_at": item.get("CreatedAt"),
        "updated_at": item.get("UpdatedAt"),
    }

    return _resp(200, task)
