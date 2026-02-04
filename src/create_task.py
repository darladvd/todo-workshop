import os
import json
import uuid
from datetime import datetime, timezone
import re

import boto3

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
    body, err = _parse_body(event)
    if err:
        return _resp(400, {"message": err})

    # Required: Title
    title = (body.get("title") or "").strip()
    if not title:
        return _resp(400, {"message": "title is required"})
    if len(title) > 200:
        return _resp(400, {"message": "title must be <= 200 characters"})

    # Optional: category (default General)
    category = (body.get("category") or "General").strip()
    if not category:
        category = "General"

    # Required: due_date (YYYY-MM-DD)
    due_date = (body.get("due_date") or "").strip()
    if not due_date:
        return _resp(400, {"message": "due_date is required"})
    if not DATE_RE.match(due_date):
        return _resp(400, {"message": "due_date must be YYYY-MM-DD"})

    # Optional: status (default Not Started)
    status = (body.get("status") or "Not Started").strip()
    if status not in ALLOWED_STATUS:
        return _resp(400, {"message": f"status must be one of {sorted(ALLOWED_STATUS)}"})

    # Optional: description
    description = body.get("description")
    if description is not None:
        description = str(description)

    task_id = str(uuid.uuid4())
    now = _now_iso()

    pk = f"TASK#{task_id}"
    gsi1pk = f"CATEGORY#{category}"
    gsi1sk = f"TASK#{due_date}#{task_id}"
    gsi2pk = "TASK"
    gsi2sk = f"{now}#{task_id}"

    item = {
        "PK": pk,
        "EntityType": "Task",
        "TaskId": task_id,
        "Title": title,
        "Category": category,
        "DueDate": due_date,
        "Status": status,
        "CreatedAt": now,
        "UpdatedAt": now,
        "GSI1PK": gsi1pk,
        "GSI1SK": gsi1sk,
        "GSI2PK": gsi2pk,
        "GSI2SK": gsi2sk,
    }

    if description is not None:
        item["Description"] = description

    table = ddb.Table(TABLE_NAME)
    table.put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")

    return _resp(201, {
        "id": task_id,
        "title": title,
        "category": category,
        "status": status,
        "due_date": due_date,
        "description": description,
        "created_at": now,
        "updated_at": now,
    })
