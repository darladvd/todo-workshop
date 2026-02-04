# src/delete_task.py
import os
import json
import boto3
from botocore.exceptions import ClientError

ddb = boto3.resource("dynamodb")
TABLE_NAME = os.environ["TABLE_NAME"]


def _resp(status_code: int, body_obj=None):
    return {
        "statusCode": int(status_code),
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
        },
        # IMPORTANT: body must always be a STRING for API Gateway proxy integration
        "body": "" if body_obj is None else json.dumps(body_obj),
    }


def lambda_handler(event, context):
    path = event.get("pathParameters") or {}
    task_id = (path.get("id") or "").strip()

    if not task_id:
        return _resp(400, {"message": "Missing path parameter: id"})

    pk = f"TASK#{task_id}"
    table = ddb.Table(TABLE_NAME)

    try:
        table.delete_item(
            Key={"PK": pk},
            ConditionExpression="attribute_exists(PK)"
        )
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code")
        if code == "ConditionalCheckFailedException":
            return _resp(404, {"message": "Task not found"})
        # surface a helpful message (still safe for workshop)
        return _resp(500, {"message": "DynamoDB error", "error": code})

    return _resp(200, {"message": "Task deleted", "id": task_id})
