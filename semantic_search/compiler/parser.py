from .ast_nodes import QueryAST
from .errors import ParseError
from .tokens import Token, TokenKind


class Parser:
    def parse(self, tokens: list[Token], source_text: str) -> QueryAST:
        action: str | None = None
        target: str | None = None
        language: str | None = None
        limit = 10
        limit_set = False
        in_topic = False
        topic_parts: list[str] = []
        index = 0

        while index < len(tokens):
            token = tokens[index]
            if token.kind == TokenKind.EOF:
                break
            if token.kind == TokenKind.RELATION:
                in_topic = True
            elif token.kind == TokenKind.ACTION:
                if in_topic:
                    # Treat English verbs like "get" / "list" inside topic clauses as search terms (PY-02)
                    topic_parts.append(token.lexeme or token.value)
                elif action is not None:
                    raise ParseError(f"Unexpected second action '{token.value}'.")
                else:
                    action = token.value.casefold()
            elif token.kind == TokenKind.TARGET:
                if in_topic:
                    topic_parts.append(token.lexeme or token.value)
                elif target is None or target == "file":
                    target = token.value
                elif token.value == "file":
                    topic_parts.append(token.lexeme or token.value)
                elif target == token.value:
                    pass
                else:
                    raise ParseError(
                        "A query can specify only one target type; "
                        f"found both '{target}' and '{token.value}'."
                    )
            elif token.kind == TokenKind.LANGUAGE:
                if language is not None and language != token.value:
                    raise ParseError(
                        "A query can specify only one programming language; "
                        f"found both '{language}' and '{token.value}'."
                    )
                language = token.value
            elif token.kind == TokenKind.LIMIT:
                # Only treat 'limit' as a directive when followed by a number; otherwise treat as a topic word (PY-02)
                if index + 1 < len(tokens) and tokens[index + 1].kind == TokenKind.NUMBER:
                    if limit_set:
                        raise ParseError("A query can specify only one 'limit' clause.")
                    index += 1
                    limit = int(tokens[index].value)
                    limit_set = True
                elif in_topic:
                    topic_parts.append(token.lexeme or token.value)
                else:
                    raise ParseError("'limit' must be followed by a whole number.")
            elif token.kind == TokenKind.PHRASE:
                # Preserve quotes so FTS5 keeps exact phrase semantics (PY-04)
                topic_parts.append(f'"{token.value}"')
            elif token.kind in {TokenKind.WORD, TokenKind.NUMBER}:
                topic_parts.append(token.value)
            index += 1

        topic = " ".join(part for part in topic_parts if part).strip()
        return QueryAST(
            action=action or "find",
            target=target,
            language=language,
            topic=topic,
            limit=limit,
            source_text=source_text,
        )
