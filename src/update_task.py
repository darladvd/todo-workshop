import os
import json
import re
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

ddb = boto3.resource("dynamodb")
TABLE_NAME = os.environ["TABLE_NAME"]

ALLOWED_STATUS = {"Not Started", "In Progress", "Done"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")  # YYYY-MM-DD


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def _parse_body(event):
    raw = event.get("body")
    if raw is None:
        return None, "Missing request body"

    if event.get("isBase64Encoded"):
        import base64
        raw = base64.b64decode(raw).decode("utf-8")

    try:
        return json.loads(raw), None
    except json.JSONDecodeError:
        return None, "Invalid JSON body"


def lambda_handler(event, context):
    # 1) Path param
    path = event.get("pathParameters") or {}
    task_id = (path.get("id") or "").strip()
    if not task_id:
        return _resp(400, {"message": "Missing path parameter: id"})

    # 2) Body
    body, err = _parse_body(event)
    if err:
        return _resp(400, {"message": err})

    if not isinstance(body, dict) or len(body.keys()) == 0:
        return _resp(400, {"message": "Request body must be a non-empty JSON object"})

    # 3) Validate only fields that are provided
    updates = {}

    if "title" in body:
        title = (body.get("title") or "").strip()
        if not title:
            return _resp(400, {"message": "title cannot be empty"})
        if len(title) > 200:
            return _resp(400, {"message": "title must be <= 200 characters"})
        updates["Title"] = title

    if "category" in body:
        category = (body.get("category") or "").strip()
        if not category:
            return _resp(400, {"message": "category cannot be empty"})
        updates["Category"] = category

    if "due_date" in body:
        due_date = (body.get("due_date") or "").strip()
        if not due_date:
            return _resp(400, {"message": "due_date cannot be empty"})
        if not DATE_RE.match(due_date):
            return _resp(400, {"message": "due_date must be YYYY-MM-DD"})
        updates["DueDate"] = due_date

    if "status" in body:
        status = (body.get("status") or "").strip()
        if status not in ALLOWED_STATUS:
            return _resp(400, {"message": f"status must be one of {sorted(ALLOWED_STATUS)}"})
        updates["Status"] = status

    if "description" in body:
        # Keep workshop simple: if provided, store as string (even empty string is allowed)
        desc = body.get("description")
        if desc is None:
            # If you want to support clearing description, simplest is set to empty string
            updates["Description"] = ""
        else:
            updates["Description"] = str(desc)

    if not updates:
        return _resp(400, {"message": "No valid fields to update"})

    pk = f"TASK#{task_id}"
    table = ddb.Table(TABLE_NAME)

    # 4) Read existing task (so we can maintain indexes if category/due_date changes)
    existing = table.get_item(Key={"PK": pk}).get("Item")
    if not existing or existing.get("EntityType") != "Task":
        return _resp(404, {"message": "Task not found"})

    # Current values
    current_category = existing.get("Category", "General")
    current_due = existing.get("DueDate")  # should exist in your model
    created_at = existing.get("CreatedAt")

    # Final values after update
    final_category = updates.get("Category", current_category)
    final_due = updates.get("DueDate", current_due)

    # due_date should exist; but just in case:
    if not final_due:
        return _resp(400, {"message": "Existing task is missing DueDate; cannot update safely"})

    # Maintain GSI1 keys
    updates["GSI1PK"] = f"CATEGORY#{final_category}"
    updates["GSI1SK"] = f"TASK#{final_due}#{task_id}"

    # Always update UpdatedAt
    updates["UpdatedAt"] = _now_iso()

    # 5) Build UpdateExpression dynamically
    expr_names = {}
    expr_values = {}
    set_parts = []

    for k, v in updates.items():
        name_key = f"#{k}"
        value_key = f":{k}"
        expr_names[name_key] = k
        expr_values[value_key] = v
        set_parts.append(f"{name_key} = {value_key}")

    update_expr = "SET " + ", ".join(set_parts)

    # Condition: item must exist (prevents creating a new item accidentally)
    try:
        resp = table.update_item(
            Key={"PK": pk},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
            ConditionExpression="attribute_exists(PK)",
            ReturnValues="ALL_NEW",
        )
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return _resp(404, {"message": "Task not found"})
        raise

    item = resp.get("Attributes", {})

    # 6) Return updated task
    return _resp(200, {
        "id": item.get("TaskId"),
        "title": item.get("Title"),
        "category": item.get("Category"),
        "status": item.get("Status"),
        "due_date": item.get("DueDate"),
        "description": item.get("Description"),
        "created_at": item.get("CreatedAt", created_at),
        "updated_at": item.get("UpdatedAt"),
    })
