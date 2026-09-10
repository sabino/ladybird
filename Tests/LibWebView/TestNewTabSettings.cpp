/*
 * Copyright (c) 2026, Sabino.
 *
 * SPDX-License-Identifier: BSD-2-Clause
 */

#include <AK/JsonArray.h>
#include <AK/JsonObject.h>
#include <LibTest/TestCase.h>
#include <LibWebView/Settings.h>

TEST_CASE(default_layout_and_empty_layout_are_distinct)
{
    auto defaults = WebView::Settings::parse_new_tab_settings(JsonObject {});
    EXPECT(defaults.as_object().get_bool("enabled"sv).value());
    EXPECT_EQ(defaults.as_object().get_array("sections"sv)->size(), 6uz);
    JsonObject input;
    input.set("sections"sv, JsonArray {});
    auto hidden = WebView::Settings::parse_new_tab_settings(input);
    EXPECT(hidden.as_object().get_array("sections"sv)->is_empty());
}

TEST_CASE(section_order_is_preserved_and_invalid_or_duplicate_names_are_ignored)
{
    JsonArray sections;
    sections.must_append("tabs"sv);
    sections.must_append("history"sv);
    sections.must_append("tabs"sv);
    sections.must_append("unknown"sv);
    sections.must_append(7);
    JsonObject input;
    input.set("sections"sv, move(sections));
    auto normalized = WebView::Settings::parse_new_tab_settings(input);
    auto const& actual = normalized.as_object().get_array("sections"sv).value();
    EXPECT_EQ(actual.size(), 2uz);
    EXPECT_EQ(actual.at(0).as_string(), "tabs"sv);
    EXPECT_EQ(actual.at(1).as_string(), "history"sv);
}

TEST_CASE(shortcuts_reject_executable_urls_and_credentials)
{
    JsonArray pins;
    for (auto url : { "javascript:alert(1)"sv, "file:///etc/passwd"sv, "https://user:secret@example.com/"sv, "https://example.com/"sv, "https://example.com/"sv }) {
        JsonObject pin;
        pin.set("url"sv, url);
        pin.set("title"sv, "<script>literal title</script>"sv);
        pins.must_append(move(pin));
    }
    JsonObject input;
    input.set("pins"sv, move(pins));
    input.set("theme"sv, "invalid"sv);
    input.set("rowsPerSection"sv, 999);
    auto normalized = WebView::Settings::parse_new_tab_settings(input);
    auto const& actual = normalized.as_object().get_array("pins"sv).value();
    EXPECT_EQ(actual.size(), 1uz);
    EXPECT_EQ(actual.at(0).as_object().get_string("title"sv).value(), "<script>literal title</script>"sv);
    EXPECT_EQ(normalized.as_object().get_string("theme"sv).value(), "catppuccin-mocha"sv);
    EXPECT_EQ(normalized.as_object().get_integer<u32>("rowsPerSection"sv).value(), 50u);
}

TEST_CASE(hidden_sections_keep_their_position_when_reenabled)
{
    auto input = TRY_OR_FAIL(JsonValue::from_string(R"({"sections":["tabs"],"sectionOrder":["history","tabs","pins"]})"sv));
    auto normalized = WebView::Settings::parse_new_tab_settings(input);
    auto const& order = normalized.as_object().get_array("sectionOrder"sv).value();
    EXPECT_EQ(order.size(), 6uz);
    EXPECT_EQ(order.at(0).as_string(), "history"sv);
    JsonArray visible;
    visible.must_append("tabs"sv);
    visible.must_append("history"sv);
    normalized.as_object().set("sections"sv, move(visible));
    auto reenabled = WebView::Settings::parse_new_tab_settings(normalized);
    auto const& sections = reenabled.as_object().get_array("sections"sv).value();
    EXPECT_EQ(sections.at(0).as_string(), "history"sv);
    EXPECT_EQ(sections.at(1).as_string(), "tabs"sv);
}
