import os
import json
import boto3
from boto3.dynamodb.conditions import Key

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
    table = ddb.Table(TABLE_NAME)

    qs = event.get("queryStringParameters") or {}
    category = (qs.get("category") or "").strip()

    # If category is provided, use GSI1 (CATEGORY + due_date sorting)
    if category:
        resp = table.query(
            IndexName="GSI1",
            KeyConditionExpression=Key("GSI1PK").eq(f"CATEGORY#{category}"),
            ScanIndexForward=True  # due_date ascending (earliest first)
        )
        items = resp.get("Items", [])
    else:
        # Otherwise, list ALL tasks using GSI2 (all tasks, sorted by created_at)
        resp = table.query(
            IndexName="GSI2",
            KeyConditionExpression=Key("GSI2PK").eq("TASK"),
            ScanIndexForward=False  # newest first
        )
        items = resp.get("Items", [])

    tasks = []
    for it in items:
        # (Projection is ALL, but keep this guard anyway)
        if it.get("EntityType") != "Task":
            continue

        tasks.append({
            "id": it.get("TaskId"),
            "title": it.get("Title"),
            "category": it.get("Category"),
            "status": it.get("Status"),
            "due_date": it.get("DueDate"),
            "description": it.get("Description"),
            "created_at": it.get("CreatedAt"),
            "updated_at": it.get("UpdatedAt"),
        })

    return _resp(200, tasks)
